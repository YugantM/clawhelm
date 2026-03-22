from __future__ import annotations

import json
import os
from dataclasses import dataclass
from typing import Any

from .models_registry import ModelRegistry, model_registry
from .performance import get_model_stats, get_score_components
from .settings import settings_store

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
    score: float


def get_openai_base_url() -> str:
    return os.getenv("PROVIDER_BASE_URL", "https://api.openai.com").rstrip("/")


def get_openai_api_key() -> str | None:
    return settings_store.get_provider_api_key("openai")


def get_openrouter_base_url() -> str:
    return os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")


def get_openrouter_api_key() -> str | None:
    return settings_store.get_provider_api_key("openrouter")


def encode_request_body(request_body: dict[str, Any]) -> bytes:
    return json.dumps(request_body, ensure_ascii=True, separators=(",", ":")).encode("utf-8")


def override_model(request_body: dict[str, Any], model: str) -> dict[str, Any]:
    updated_body = dict(request_body)
    updated_body["model"] = model
    return updated_body


def get_ranked_candidate_snapshot(registry: ModelRegistry = model_registry) -> list[dict[str, Any]]:
    available_models = registry.get_available_models()
    scored: list[dict[str, Any]] = []

    for candidate in available_models:
        stats = get_model_stats(candidate["model_id"])
        components = get_score_components(stats)
        success_rate = float(components["success_rate"])
        sample_count = int(components["sample_count"])
        excluded = sample_count > 0 and success_rate < 0.7
        scored.append(
            {
                "provider": candidate["provider"],
                "model_id": candidate["model_id"],
                "is_free": bool(candidate["is_free"]),
                "enabled": bool(candidate.get("enabled", True)),
                "success_rate": success_rate,
                "avg_latency": float(components["avg_latency"]),
                "avg_cost": float(components["avg_cost"]),
                "latency_score": float(components["latency_score"]),
                "cost_score": float(components["cost_score"]),
                "confidence": float(components["confidence"]),
                "score": float(components["score"]),
                "sample_count": sample_count,
                "excluded": excluded,
                "exclusion_reason": "success_rate_below_threshold" if excluded else None,
            }
        )

    if not scored:
        return []

    ranked = sorted(
        scored,
        key=lambda candidate: (
            1 if candidate["excluded"] else 0,
            -candidate["score"],
            0 if candidate["model_id"] == OPENROUTER_FREE_ROUTER else 1,
            0 if candidate["is_free"] else 1,
            candidate["model_id"],
        ),
    )

    for index, candidate in enumerate(ranked, start=1):
        candidate["rank"] = index

    return ranked


def get_ranked_route_decisions(registry: ModelRegistry = model_registry) -> list[RouteDecision]:
    ranked_candidates = get_ranked_candidate_snapshot(registry=registry)
    allowed_candidates = [candidate for candidate in ranked_candidates if not candidate["excluded"]]
    if allowed_candidates:
        return [
            _build_decision(candidate, float(candidate["score"]), "selected based on performance score")
            for candidate in allowed_candidates
        ]

    fallback_candidates = [candidate for candidate in ranked_candidates if candidate["is_free"]] or ranked_candidates
    return [
        _build_decision(candidate, float(candidate["score"]), "fallback to best available free model")
        for candidate in fallback_candidates
    ]


def resolve_route_decision(registry: ModelRegistry = model_registry) -> RouteDecision:
    ranked = get_ranked_route_decisions(registry=registry)
    if not ranked:
        raise RuntimeError("No available models for routing")
    return ranked[0]


def _build_decision(candidate: dict[str, Any], score: float, reason: str) -> RouteDecision:
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
        score=score,
    )
