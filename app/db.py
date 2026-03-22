from __future__ import annotations

import asyncio
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .config.feature_flags import ENABLE_PREMIUM_ROUTING, is_cloud_mode
from .costs import estimate_cost_saved_for_free_request
from .models import LogEntry
from .services.performance import get_performance_by_model

DEFAULT_DB_PATH = Path(__file__).resolve().parent.parent / "clawhelm.db"
DB_PATH = Path(os.getenv("CLAWHELM_DB_PATH", str(DEFAULT_DB_PATH))).expanduser().resolve()


class Database:
    def __init__(self, db_path: Path = DB_PATH) -> None:
        self.db_path = db_path

    async def init(self) -> None:
        await asyncio.to_thread(self._init_sync)

    def _connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.db_path)
        connection.row_factory = sqlite3.Row
        return connection

    def _init_sync(self) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS logs (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    timestamp TEXT NOT NULL,
                    session_id TEXT,
                    request_source TEXT,
                    original_model TEXT,
                    selected_model TEXT,
                    actual_model TEXT,
                    model_display_name TEXT,
                    provider TEXT,
                    is_free_model INTEGER NOT NULL DEFAULT 0,
                    model_source TEXT,
                    routing_reason TEXT,
                    routing_score REAL,
                    status_code INTEGER,
                    fallback_used INTEGER NOT NULL DEFAULT 0,
                    prompt TEXT,
                    response TEXT,
                    latency REAL NOT NULL,
                    total_tokens INTEGER,
                    estimated_cost REAL NOT NULL DEFAULT 0
                )
                """
            )
            self._ensure_column(connection, "original_model", "TEXT")
            self._ensure_column(connection, "session_id", "TEXT")
            self._ensure_column(connection, "request_source", "TEXT")
            self._ensure_column(connection, "selected_model", "TEXT")
            self._ensure_column(connection, "actual_model", "TEXT")
            self._ensure_column(connection, "model_display_name", "TEXT")
            self._ensure_column(connection, "provider", "TEXT")
            self._ensure_column(connection, "is_free_model", "INTEGER NOT NULL DEFAULT 0")
            self._ensure_column(connection, "model_source", "TEXT")
            self._ensure_column(connection, "routing_reason", "TEXT")
            self._ensure_column(connection, "routing_score", "REAL")
            self._ensure_column(connection, "status_code", "INTEGER")
            self._ensure_column(connection, "fallback_used", "INTEGER NOT NULL DEFAULT 0")
            self._ensure_column(connection, "estimated_cost", "REAL NOT NULL DEFAULT 0")
            self._rename_legacy_model_column(connection)
            connection.commit()

    @staticmethod
    def _ensure_column(
        connection: sqlite3.Connection,
        column_name: str,
        column_type: str,
    ) -> None:
        existing_columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(logs)").fetchall()
        }
        if column_name not in existing_columns:
            connection.execute(
                f"ALTER TABLE logs ADD COLUMN {column_name} {column_type}"
            )

    @staticmethod
    def _rename_legacy_model_column(connection: sqlite3.Connection) -> None:
        columns = {
            row["name"]
            for row in connection.execute("PRAGMA table_info(logs)").fetchall()
        }
        if "model" in columns:
            connection.execute(
                """
                UPDATE logs
                SET original_model = COALESCE(original_model, model),
                    selected_model = COALESCE(selected_model, model)
                WHERE model IS NOT NULL
                """
            )
        connection.execute(
            """
            UPDATE logs
            SET actual_model = COALESCE(actual_model, selected_model),
                model_display_name = COALESCE(model_display_name, selected_model)
            WHERE actual_model IS NULL OR model_display_name IS NULL
            """
        )

    async def insert_log(
        self,
        *,
        session_id: str | None,
        request_source: str | None,
        original_model: str | None,
        selected_model: str | None,
        actual_model: str | None,
        model_display_name: str | None,
        provider: str | None,
        is_free_model: bool,
        model_source: str | None,
        routing_reason: str | None,
        routing_score: float | None,
        status_code: int | None,
        fallback_used: bool,
        prompt: str | None,
        response: str | None,
        latency: float,
        total_tokens: int | None,
        estimated_cost: float,
    ) -> None:
        await asyncio.to_thread(
            self._insert_log_sync,
            session_id,
            request_source,
            original_model,
            selected_model,
            actual_model,
            model_display_name,
            provider,
            is_free_model,
            model_source,
            routing_reason,
            routing_score,
            status_code,
            fallback_used,
            prompt,
            response,
            latency,
            total_tokens,
            estimated_cost,
        )

    def _insert_log_sync(
        self,
        session_id: str | None,
        request_source: str | None,
        original_model: str | None,
        selected_model: str | None,
        actual_model: str | None,
        model_display_name: str | None,
        provider: str | None,
        is_free_model: bool,
        model_source: str | None,
        routing_reason: str | None,
        routing_score: float | None,
        status_code: int | None,
        fallback_used: bool,
        prompt: str | None,
        response: str | None,
        latency: float,
        total_tokens: int | None,
        estimated_cost: float,
    ) -> None:
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO logs (
                    timestamp,
                    session_id,
                    request_source,
                    original_model,
                    selected_model,
                    actual_model,
                    model_display_name,
                    provider,
                    is_free_model,
                    model_source,
                    routing_reason,
                    routing_score,
                    status_code,
                    fallback_used,
                    prompt,
                    response,
                    latency,
                    total_tokens,
                    estimated_cost
                )
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    datetime.now(timezone.utc).isoformat(),
                    session_id,
                    request_source,
                    original_model,
                    selected_model,
                    actual_model,
                    model_display_name,
                    provider,
                    int(is_free_model),
                    model_source,
                    routing_reason,
                    routing_score,
                    status_code,
                    int(fallback_used),
                    prompt,
                    response,
                    latency,
                    total_tokens,
                    estimated_cost,
                ),
            )
            connection.commit()

    async def get_recent_logs(self, limit: int = 50) -> list[LogEntry]:
        rows = await asyncio.to_thread(self._get_recent_logs_sync, limit)
        return [self._row_to_log_entry(row) for row in rows]

    def _get_recent_logs_sync(self, limit: int) -> list[sqlite3.Row]:
        with self._connect() as connection:
            cursor = connection.execute(
                """
                SELECT
                    id,
                    timestamp,
                    session_id,
                    request_source,
                    original_model,
                    selected_model,
                    actual_model,
                    model_display_name,
                    provider,
                    is_free_model,
                    model_source,
                    routing_reason,
                    routing_score,
                    status_code,
                    fallback_used,
                    prompt,
                    response,
                    latency,
                    total_tokens,
                    estimated_cost
                FROM logs
                ORDER BY id DESC
                LIMIT ?
                """,
                (limit,),
            )
            return cursor.fetchall()

    async def get_stats(self) -> dict[str, Any]:
        rows = await asyncio.to_thread(self._get_stats_rows_sync)
        total_requests = len(rows)
        successful_requests = 0
        failed_requests = 0
        fallback_count = 0
        total_latency = 0.0
        total_estimated_cost_usd = 0.0
        free_requests = 0
        cost_saved_estimate = 0.0
        requests_by_actual_model: dict[str, int] = {}
        usage_by_provider: dict[str, int] = {}

        for row in rows:
            provider = row["provider"] or "unknown"
            usage_by_provider[provider] = usage_by_provider.get(provider, 0) + 1
            actual_model = row["actual_model"] or row["selected_model"] or "unknown"
            requests_by_actual_model[actual_model] = requests_by_actual_model.get(actual_model, 0) + 1
            status_code = row["status_code"]
            if status_code is not None and 200 <= status_code < 400:
                successful_requests += 1
            else:
                failed_requests += 1
            if row["fallback_used"]:
                fallback_count += 1
            if row["is_free_model"]:
                free_requests += 1
                cost_saved_estimate += estimate_cost_saved_for_free_request(row["total_tokens"])
            total_latency += row["latency"] or 0.0
            total_estimated_cost_usd += row["estimated_cost"] or 0.0

        return {
            "total_requests": total_requests,
            "successful_requests": successful_requests,
            "failed_requests": failed_requests,
            "fallback_count": fallback_count,
            "avg_latency": round(total_latency / total_requests, 6) if total_requests else 0.0,
            "total_estimated_cost_usd": round(total_estimated_cost_usd, 6),
            "free_model_usage_count": free_requests,
            "requests_using_free_models": free_requests,
            "cost_saved_estimate": round(cost_saved_estimate, 6),
            "requests_by_actual_model": requests_by_actual_model,
            "requests_by_provider": usage_by_provider,
            "usage_by_provider": usage_by_provider,
            "performance_by_model": get_performance_by_model(),
            "candidate_scores": self._get_candidate_scores(),
        }

    def _get_stats_rows_sync(self) -> list[sqlite3.Row]:
        with self._connect() as connection:
            cursor = connection.execute(
                """
                SELECT provider, is_free_model, total_tokens, status_code, fallback_used, estimated_cost, actual_model, selected_model, latency
                FROM logs
                """
            )
            return cursor.fetchall()

    @staticmethod
    def _get_candidate_scores() -> list[dict[str, Any]]:
        if is_cloud_mode() and ENABLE_PREMIUM_ROUTING:
            from .cloud.premium_router import get_ranked_candidate_snapshot

            return get_ranked_candidate_snapshot()
        return []

    @staticmethod
    def _row_to_log_entry(row: sqlite3.Row) -> LogEntry:
        return LogEntry(
            id=row["id"],
            timestamp=datetime.fromisoformat(row["timestamp"]),
            session_id=row["session_id"],
            request_source=row["request_source"],
            original_model=row["original_model"],
            selected_model=row["selected_model"],
            actual_model=row["actual_model"] or row["selected_model"],
            model_display_name=row["model_display_name"] or row["selected_model"],
            provider=row["provider"],
            is_free_model=bool(row["is_free_model"]),
            model_source=row["model_source"],
            routing_reason=row["routing_reason"],
            routing_score=row["routing_score"],
            status_code=row["status_code"],
            fallback_used=bool(row["fallback_used"]),
            prompt=row["prompt"],
            response=row["response"],
            latency=row["latency"],
            total_tokens=row["total_tokens"],
            estimated_cost=row["estimated_cost"],
        )


db = Database()
