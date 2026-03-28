from __future__ import annotations

from typing import Any


NEUTRAL_SCORE = 0.5
SMALL_COST_VALUE = 0.0001

# Weights: quality most important, speed prioritized over cost
QUALITY_WEIGHT = 0.4
SPEED_WEIGHT = 0.35
COST_WEIGHT = 0.25

# Quality floor: don't route to consistently broken models
QUALITY_FLOOR_MIN_SAMPLES = 5
QUALITY_FLOOR_THRESHOLD = 0.3


def cold_start_score(model: dict[str, Any], *, benchmark_latency: float | None = None) -> float:
    """Score a model with no request history using metadata and optional benchmark data."""
    prompt_cost = float(model.get("prompt_cost", 0.0))
    is_free = model.get("is_free", False)
    context_length = int(model.get("context_length", 4096))

    # Cost component: cheaper = higher score
    if prompt_cost <= 0:
        cost_score = 1.0
    else:
        cost_per_million = prompt_cost * 1_000_000
        cost_score = min(1.0 / max(cost_per_million, 0.01), 1.0)

    free_bonus = 0.1 if is_free else 0.0
    context_bonus = 0.02 if context_length >= 128_000 else 0.0

    # Speed: use benchmark latency if available, otherwise neutral
    if benchmark_latency is not None and benchmark_latency > 0:
        raw_speed = 1.0 / max(benchmark_latency, 0.1)
        speed_score = min(raw_speed / 10.0, 1.0)  # normalize to 0-1
    else:
        speed_score = NEUTRAL_SCORE

    score = (
        NEUTRAL_SCORE * QUALITY_WEIGHT
        + speed_score * SPEED_WEIGHT
        + cost_score * COST_WEIGHT
        + free_bonus
        + context_bonus
    )
    return round(score, 6)


def score_model(
    model: dict[str, Any],
    stats: dict[str, float | int],
    *,
    benchmark_latency: float | None = None,
) -> float:
    sample_count = int(stats.get("sample_count", 0))
    if sample_count == 0:
        return cold_start_score(model, benchmark_latency=benchmark_latency)

    success_rate = float(stats.get("success_rate", NEUTRAL_SCORE))

    # Quality floor: don't route to consistently broken models
    if sample_count >= QUALITY_FLOOR_MIN_SAMPLES and success_rate < QUALITY_FLOOR_THRESHOLD:
        return 0.0

    # No successful requests yet — treat as cold-start (don't reward fast errors)
    if success_rate == 0.0:
        return cold_start_score(model, benchmark_latency=benchmark_latency) * 0.5

    live_latency = max(float(stats.get("avg_latency", 1.0)), 0.001)

    # Blend benchmark and live latency for models with few samples
    if benchmark_latency is not None and benchmark_latency > 0 and sample_count < 10:
        weight = sample_count / 10.0
        latency = weight * live_latency + (1 - weight) * benchmark_latency
    else:
        latency = live_latency

    cost = max(float(stats.get("avg_cost", 0.0)), 0.0)
    score = (
        success_rate * QUALITY_WEIGHT
        + (1 / latency) * SPEED_WEIGHT
        + (1 / (cost if cost > 0 else SMALL_COST_VALUE)) * COST_WEIGHT
    )
    return round(score, 6)


def dimension_scores(model: dict[str, Any]) -> dict[str, float]:
    """Return per-dimension scores for ranking. Higher = better."""
    prompt_cost = float(model.get("prompt_cost", 0.0))
    is_free = model.get("is_free", False)

    # Cost dimension: cheaper = higher score
    if prompt_cost <= 0:
        cost_score = 1.0
    else:
        cost_per_million = prompt_cost * 1_000_000
        cost_score = min(1.0 / max(cost_per_million, 0.01), 1.0)
    if is_free:
        cost_score += 0.1

    # Speed dimension: cold-start neutral (no live data available at listing time)
    speed_score = NEUTRAL_SCORE

    # Quality dimension: cold-start neutral
    quality_score = NEUTRAL_SCORE

    return {
        "overall": cold_start_score(model),
        "speed": round(speed_score, 6),
        "quality": round(quality_score, 6),
        "cost": round(cost_score, 6),
    }


def get_score_components(stats: dict[str, float | int], model: dict[str, Any] | None = None) -> dict[str, float | int]:
    sample_count = int(stats.get("sample_count", 0))
    if sample_count == 0:
        cs = cold_start_score(model or {})
        return {
            "success_rate": NEUTRAL_SCORE,
            "avg_latency": float(stats.get("avg_latency", 1.0)),
            "avg_cost": float(stats.get("avg_cost", 0.01)),
            "sample_count": 0,
            "latency_score": NEUTRAL_SCORE,
            "cost_score": NEUTRAL_SCORE,
            "confidence": 0.0,
            "score": cs,
        }

    avg_latency = max(float(stats.get("avg_latency", 1.0)), 0.001)
    avg_cost = max(float(stats.get("avg_cost", 0.0)), 0.0)
    latency_score = round(1 / avg_latency, 6)
    cost_score = round(1 / (avg_cost if avg_cost > 0 else SMALL_COST_VALUE), 6)
    return {
        "success_rate": round(float(stats.get("success_rate", NEUTRAL_SCORE)), 6),
        "avg_latency": avg_latency,
        "avg_cost": avg_cost,
        "sample_count": sample_count,
        "latency_score": latency_score,
        "cost_score": cost_score,
        "confidence": 1.0 if sample_count > 0 else 0.0,
        "score": score_model(model or {}, stats),
    }
