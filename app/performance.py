from __future__ import annotations

import os
import sqlite3
from pathlib import Path
from typing import Any

from .scoring import get_score_components


DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "clawhelm.db"
DB_PATH = Path(os.getenv("CLAWHELM_DB_PATH", str(DEFAULT_DB_PATH))).expanduser().resolve()
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
                AVG(CASE WHEN status_code >= 200 AND status_code < 400 THEN latency END) AS avg_latency,
                AVG(CASE WHEN status_code >= 200 AND status_code < 400 THEN estimated_cost END) AS avg_cost
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
        model_id = row["model_id"]
        models.append(
            {
                "model_id": model_id,
                "provider": row["provider"] or ("openrouter" if str(model_id).endswith(":free") else "openai"),
                "is_free": bool(row["is_free"]),
                "success_rate": (success_count / total_count) if total_count else 0.0,
            }
        )
    return models


def get_performance_by_model() -> dict[str, dict[str, float]]:
    performance: dict[str, dict[str, float]] = {}
    for model in get_successful_models(include_all=True):
        model_id = model["model_id"]
        stats = get_model_stats(model_id)
        components = get_score_components(stats, model)
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
