from __future__ import annotations

from typing import Any


NEUTRAL_SCORE = 0.5
SMALL_COST_VALUE = 0.0001


def score_model(model: dict[str, Any], stats: dict[str, float | int]) -> float:
    sample_count = int(stats.get("sample_count", 0))
    if sample_count == 0:
        return NEUTRAL_SCORE

    success_rate = float(stats.get("success_rate", NEUTRAL_SCORE))
    latency = max(float(stats.get("avg_latency", 1.0)), 0.001)
    cost = max(float(stats.get("avg_cost", 0.0)), 0.0)
    score = (
        success_rate * 0.5 +
        (1 / latency) * 0.25 +
        (1 / (cost if cost > 0 else SMALL_COST_VALUE)) * 0.25
    )
    return round(score, 6)


def get_score_components(stats: dict[str, float | int], model: dict[str, Any] | None = None) -> dict[str, float | int]:
    sample_count = int(stats.get("sample_count", 0))
    if sample_count == 0:
        return {
            "success_rate": NEUTRAL_SCORE,
            "avg_latency": float(stats.get("avg_latency", 1.0)),
            "avg_cost": float(stats.get("avg_cost", 0.01)),
            "sample_count": 0,
            "latency_score": NEUTRAL_SCORE,
            "cost_score": NEUTRAL_SCORE,
            "confidence": 0.0,
            "score": NEUTRAL_SCORE,
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

