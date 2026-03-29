from __future__ import annotations

import json
import random
import time
from dataclasses import dataclass
from typing import Any

from .db import db
from .models_registry import ModelRegistry, model_registry
from .performance import get_model_stats
from .providers import provider_registry
from .scoring import score_model

OPENROUTER_FREE_ROUTER = "openrouter/free"

FREE_MODEL_BONUS = 0.03  # small tie-breaker, not enough to override quality/speed
EXPLORATION_RATE = 0.10
SCORE_CACHE_TTL = 60.0

_score_cache: dict[str, tuple[float, float]] = {}  # model_id -> (score, timestamp)


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


def encode_request_body(request_body: dict[str, Any]) -> bytes:
    return json.dumps(request_body, ensure_ascii=True, separators=(",", ":")).encode("utf-8")


def override_model(request_body: dict[str, Any], model: str) -> dict[str, Any]:
    updated_body = dict(request_body)
    updated_body["model"] = model
    return updated_body


def _get_cached_score(model_id: str, model_dict: dict[str, Any]) -> float:
    now = time.monotonic()
    cached = _score_cache.get(model_id)
    if cached is not None:
        cached_score, cached_at = cached
        if now - cached_at < SCORE_CACHE_TTL:
            return cached_score

    stats = get_model_stats(model_id)
    benchmark_latency = db.get_benchmark_latency(model_id)
    computed_score = score_model(model_dict, stats, benchmark_latency=benchmark_latency)
    if model_dict.get("is_free"):
        computed_score += FREE_MODEL_BONUS
    _score_cache[model_id] = (computed_score, now)
    return computed_score


def _deduplicate_by_base_model(
    scored: list[tuple[dict[str, Any], float]],
) -> list[tuple[dict[str, Any], float]]:
    """When same base model exists from multiple providers, keep only the best one."""
    seen_base: dict[str, int] = {}
    result: list[tuple[dict[str, Any], float]] = []
    for model_dict, score in scored:
        base = model_dict.get("base_model", model_dict["model_id"])
        if base in seen_base:
            # Already have a higher-scored entry for this base model — skip
            continue
        seen_base[base] = len(result)
        result.append((model_dict, score))
    return result


def get_route_decisions(request_body: dict[str, Any] | None, registry: ModelRegistry = model_registry) -> list[RouteDecision]:
    available_models = registry.get_available_models()
    if not available_models:
        return []

    scored_models = _score_and_rank(available_models)
    decisions: list[RouteDecision] = []
    for index, (candidate, candidate_score) in enumerate(scored_models):
        reason = f"score {candidate_score:.3f}" if index == 0 else "fallback"
        decisions.append(_build_decision(candidate, reason, candidate_score))
    return decisions


def _score_and_rank(available_models: list[dict[str, Any]]) -> list[tuple[dict[str, Any], float]]:
    scored: list[tuple[dict[str, Any], float]] = []
    for model in available_models:
        model_score = _get_cached_score(model["model_id"], model)
        scored.append((model, model_score))

    scored.sort(key=lambda pair: pair[1], reverse=True)

    # Deduplicate: same base model from multiple providers -> keep best
    scored = _deduplicate_by_base_model(scored)

    if len(scored) > 1 and random.random() < EXPLORATION_RATE:
        explore_index = random.randint(1, len(scored) - 1)
        explored = scored.pop(explore_index)
        scored.insert(0, explored)
        scored[0] = (scored[0][0], scored[0][1])

    return scored


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
    candidate = {
        "provider": model.provider,
        "model_id": model.id,
        "base_model": model.base_model,
        "is_free": model.is_free,
        "source": model.source,
        "prompt_cost": model.prompt_cost,
        "completion_cost": model.completion_cost,
        "context_length": model.context_length,
    }
    stats = get_model_stats(model_id)
    benchmark_latency = db.get_benchmark_latency(model_id)
    candidate_score = score_model(candidate, stats, benchmark_latency=benchmark_latency)
    return _build_decision(candidate, "manual selection", candidate_score)


def _build_decision(candidate: dict[str, Any], reason: str, candidate_score: float | None = None) -> RouteDecision:
    provider_name = candidate["provider"]
    config = provider_registry.get(provider_name)
    if config is None:
        raise ValueError(f"Unknown provider: {provider_name}")
    return RouteDecision(
        model=candidate["model_id"],
        provider=provider_name,
        base_url=provider_registry.get_base_url(provider_name),
        chat_path=config.chat_path,
        api_key=provider_registry.get_api_key(provider_name),
        is_free_model=bool(candidate.get("is_free")),
        model_source="available_pool",
        routing_reason=reason,
        score=candidate_score,
    )
