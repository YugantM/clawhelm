from __future__ import annotations

from ..config.settings import settings_store
from ..services.performance import get_model_stats
from ..services.scoring import get_score_components
from ..core.models_registry import ModelRegistry, model_registry
from ..core.router import (
    OPENAI_PROVIDER,
    OPENROUTER_PROVIDER,
    OPENROUTER_FREE_ROUTER,
    RouteDecision,
    get_openai_base_url,
    get_openrouter_base_url,
)


def get_ranked_candidate_snapshot(registry: ModelRegistry = model_registry) -> list[dict]:
    available_models = registry.get_available_models()
    scored: list[dict] = []

    for candidate in available_models:
        stats = get_model_stats(candidate["model_id"])
        components = get_score_components(stats, candidate)
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


def get_route_decisions(registry: ModelRegistry = model_registry) -> list[RouteDecision]:
    ranked_candidates = get_ranked_candidate_snapshot(registry=registry)
    allowed_candidates = [candidate for candidate in ranked_candidates if not candidate["excluded"]]
    if allowed_candidates:
        return [_build_decision(candidate, "selected based on performance score") for candidate in allowed_candidates]

    fallback_candidates = [candidate for candidate in ranked_candidates if candidate["is_free"]] or ranked_candidates
    return [_build_decision(candidate, "fallback to best available free model") for candidate in fallback_candidates]


def _build_decision(candidate: dict, reason: str) -> RouteDecision:
    provider = candidate["provider"]
    return RouteDecision(
        model=candidate["model_id"],
        provider=provider,
        base_url=get_openrouter_base_url() if provider == OPENROUTER_PROVIDER else get_openai_base_url(),
        chat_path="/chat/completions" if provider == OPENROUTER_PROVIDER else "/v1/chat/completions",
        api_key=settings_store.get_provider_api_key("openrouter") if provider == OPENROUTER_PROVIDER else settings_store.get_provider_api_key("openai"),
        is_free_model=bool(candidate["is_free"]),
        model_source="available_pool",
        routing_reason=reason,
        score=float(candidate["score"]),
    )
