from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any

DB_PATH = Path(os.getenv("CLAWHELM_DB_PATH", "clawhelm.db"))
LATENCY_REFERENCE_SECONDS = 1.5
COST_REFERENCE_USD = 0.02
CONFIDENCE_SAMPLE_TARGET = 3
NEUTRAL_STATS = {
    "success_rate": 0.5,
    "avg_latency": 1.0,
    "avg_cost": 0.01,
    "sample_count": 0,
}


def _connect() -> sqlite3.Connection:
    connection = sqlite3.connect(DB_PATH)
    connection.row_factory = sqlite3.Row
    return connection


def get_model_stats(model_id: str) -> dict[str, float | int]:
    with _connect() as connection:
        row = connection.execute(
            """
            SELECT
                COUNT(*) AS total_count,
                SUM(CASE WHEN status_code >= 200 AND status_code < 400 THEN 1 ELSE 0 END) AS success_count,
                AVG(latency) AS avg_latency,
                AVG(estimated_cost) AS avg_cost
            FROM logs
            WHERE actual_model = ? OR selected_model = ?
            """,
            (model_id, model_id),
        ).fetchone()

    total_count = row["total_count"] if row and row["total_count"] else 0
    if total_count == 0:
        return dict(NEUTRAL_STATS)

    success_count = row["success_count"] or 0
    return {
        "success_rate": round(success_count / total_count, 6),
        "avg_latency": float(row["avg_latency"] or NEUTRAL_STATS["avg_latency"]),
        "avg_cost": float(row["avg_cost"] or 0.0),
        "sample_count": int(total_count),
    }


def get_score_components(stats: dict[str, float | int]) -> dict[str, float | int]:
    sample_count = int(stats.get("sample_count", 0))
    if sample_count == 0:
        return {
            "success_rate": float(NEUTRAL_STATS["success_rate"]),
            "avg_latency": float(NEUTRAL_STATS["avg_latency"]),
            "avg_cost": float(NEUTRAL_STATS["avg_cost"]),
            "sample_count": 0,
            "latency_score": 0.5,
            "cost_score": 0.5,
            "confidence": 0.0,
            "score": 0.5,
        }

    success_rate = float(stats.get("success_rate", 0.5))
    latency = max(float(stats.get("avg_latency", 1.0)), 0.001)
    cost = max(float(stats.get("avg_cost", 0.01)), 0.0)
    latency_score = 1.0 / (1.0 + (latency / LATENCY_REFERENCE_SECONDS))
    cost_score = 1.0 / (1.0 + (cost / COST_REFERENCE_USD))
    raw_score = (
        (success_rate * 0.55) +
        (latency_score * 0.30) +
        (cost_score * 0.15)
    )
    confidence = min(sample_count / CONFIDENCE_SAMPLE_TARGET, 1.0)
    score = round((raw_score * confidence) + (0.5 * (1.0 - confidence)), 6)
    return {
        "success_rate": round(success_rate, 6),
        "avg_latency": latency,
        "avg_cost": cost,
        "sample_count": sample_count,
        "latency_score": round(latency_score, 6),
        "cost_score": round(cost_score, 6),
        "confidence": round(confidence, 6),
        "score": score,
    }


def score_model(model: dict[str, Any], stats: dict[str, float | int]) -> float:
    return float(get_score_components(stats)["score"])


def get_performance_by_model() -> dict[str, dict[str, float]]:
    performance: dict[str, dict[str, float]] = {}
    for model in get_successful_models(include_all=True):
        model_id = model["model_id"]
        stats = get_model_stats(model_id)
        components = get_score_components(stats)
        performance[model_id] = {
            "success_rate": float(components["success_rate"]),
            "avg_latency": float(components["avg_latency"]),
            "avg_cost": float(components["avg_cost"]),
            "latency_score": float(components["latency_score"]),
            "cost_score": float(components["cost_score"]),
            "confidence": float(components["confidence"]),
            "score": float(components["score"]),
            "sample_count": float(components["sample_count"]),
        }
    return performance


def get_successful_models(*, include_all: bool = False) -> list[dict[str, Any]]:
    with _connect() as connection:
        rows = connection.execute(
            """
            SELECT
                COALESCE(actual_model, selected_model) AS model_id,
                provider,
                MAX(is_free_model) AS is_free,
                SUM(CASE WHEN status_code >= 200 AND status_code < 400 THEN 1 ELSE 0 END) AS success_count,
                COUNT(*) AS total_count
            FROM logs
            GROUP BY COALESCE(actual_model, selected_model), provider
            """
        ).fetchall()

    models: list[dict[str, Any]] = []
    for row in rows:
        total_count = row["total_count"] or 0
        success_count = row["success_count"] or 0
        if not include_all and success_count == 0:
            continue
        models.append(
            {
                "model_id": row["model_id"],
                "provider": row["provider"] or ("openrouter" if str(row["model_id"]).endswith(":free") else "openai"),
                "is_free": bool(row["is_free"]),
                "success_rate": (success_count / total_count) if total_count else 0.0,
            }
        )
    return models
