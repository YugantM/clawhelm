from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

from .models_registry import ModelRegistry, model_registry
from ..config.settings import settings_store

OPENAI_PROVIDER = "openai"
OPENROUTER_PROVIDER = "openrouter"
OPENROUTER_FREE_ROUTER = "openrouter/free"


@dataclass(slots=True)
class RouteDecision:
    model: str
    provider: str
    base_url: str
    chat_path: str
    api_key: str | None
    is_free_model: bool
    model_source: str
    routing_reason: str
    score: float | None


def get_openai_base_url() -> str:
    return os.getenv("PROVIDER_BASE_URL", "https://api.openai.com").rstrip("/")


def get_openrouter_base_url() -> str:
    return os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")


def get_openai_api_key() -> str | None:
    return settings_store.get_provider_api_key("openai")


def get_openrouter_api_key() -> str | None:
    return settings_store.get_provider_api_key("openrouter")


def encode_request_body(request_body: dict[str, Any]) -> bytes:
    return json.dumps(request_body, ensure_ascii=True, separators=(",", ":")).encode("utf-8")


def override_model(request_body: dict[str, Any], model: str) -> dict[str, Any]:
    updated_body = dict(request_body)
    updated_body["model"] = model
    return updated_body


def extract_prompt_length(request_body: dict[str, Any] | None) -> int:
    if not isinstance(request_body, dict):
        return 0
    messages = request_body.get("messages")
    if not isinstance(messages, list):
        return 0
    parts: list[str] = []
    for message in messages:
        if not isinstance(message, dict):
            continue
        content = message.get("content")
        if isinstance(content, str):
            parts.append(content)
    return len("\n".join(parts))


def get_route_decisions(request_body: dict[str, Any] | None, registry: ModelRegistry = model_registry) -> list[RouteDecision]:
    available_models = registry.get_available_models()
    if not available_models:
        return []

    prompt_length = extract_prompt_length(request_body)
    preferred_model = _select_preferred_model(prompt_length, available_models)
    ordered_models = _order_candidates(preferred_model, available_models)
    decisions: list[RouteDecision] = []
    for index, candidate in enumerate(ordered_models):
        decisions.append(
            _build_decision(
                candidate,
                "selected by core prompt-length routing" if index == 0 else "core fallback",
            )
        )
    return decisions


def resolve_model_alias(requested_model: str | None, registry: ModelRegistry = model_registry) -> str | None:
    if requested_model in {None, "", "auto", "clawhelm-auto"}:
        return None
    if registry.get_model(requested_model) is not None:
        return requested_model
    return None


def is_valid_chat_model(requested_model: str | None, registry: ModelRegistry = model_registry) -> bool:
    if requested_model in {None, "", "auto", "clawhelm-auto"}:
        return True
    return registry.get_model(requested_model) is not None


def get_direct_route_decision(model_id: str, registry: ModelRegistry = model_registry) -> RouteDecision:
    model = registry.get_model(model_id)
    if model is None:
        raise ValueError(f"Unknown model: {model_id}")
    return _build_decision(
        {
            "provider": model.provider,
            "model_id": model.id,
            "is_free": model.is_free,
            "source": model.source,
        },
        "manual selection",
    )


def _select_preferred_model(prompt_length: int, available_models: list[dict[str, Any]]) -> dict[str, Any]:
    available_ids = {candidate["model_id"]: candidate for candidate in available_models}
    cheap_model = os.getenv("CHEAP_MODEL", "gpt-3.5-turbo")
    mid_model = os.getenv("MID_MODEL", "gpt-4o-mini")
    expensive_model = os.getenv("EXPENSIVE_MODEL", "gpt-4o")

    if prompt_length < 200 and OPENROUTER_FREE_ROUTER in available_ids:
        return available_ids[OPENROUTER_FREE_ROUTER]
    if prompt_length < 1000 and cheap_model in available_ids:
        return available_ids[cheap_model]
    if prompt_length < 1000 and mid_model in available_ids:
        return available_ids[mid_model]
    if expensive_model in available_ids:
        return available_ids[expensive_model]
    return available_models[0]


def _order_candidates(preferred_model: dict[str, Any], available_models: list[dict[str, Any]]) -> list[dict[str, Any]]:
    remaining = [candidate for candidate in available_models if candidate["model_id"] != preferred_model["model_id"]]
    remaining.sort(key=lambda candidate: (0 if candidate["is_free"] else 1, candidate["model_id"]))
    return [preferred_model, *remaining]


def _build_decision(candidate: dict[str, Any], reason: str) -> RouteDecision:
    provider = candidate["provider"]
    return RouteDecision(
        model=candidate["model_id"],
        provider=provider,
        base_url=get_openrouter_base_url() if provider == OPENROUTER_PROVIDER else get_openai_base_url(),
        chat_path="/chat/completions" if provider == OPENROUTER_PROVIDER else "/v1/chat/completions",
        api_key=get_openrouter_api_key() if provider == OPENROUTER_PROVIDER else get_openai_api_key(),
        is_free_model=bool(candidate["is_free"]),
        model_source="available_pool",
        routing_reason=reason,
        score=None,
    )
