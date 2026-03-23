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
                    user_id TEXT,
                    request_count INTEGER,
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
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS users (
                    id TEXT PRIMARY KEY,
                    email TEXT NOT NULL UNIQUE,
                    name TEXT NOT NULL,
                    password_hash TEXT,
                    plan TEXT NOT NULL DEFAULT 'free',
                    is_superuser INTEGER NOT NULL DEFAULT 0,
                    requests_today INTEGER NOT NULL DEFAULT 0,
                    last_updated TEXT NOT NULL,
                    stripe_customer_id TEXT,
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS oauth_accounts (
                    provider TEXT NOT NULL,
                    provider_user_id TEXT NOT NULL,
                    user_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    PRIMARY KEY (provider, provider_user_id)
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    token_hash TEXT PRIMARY KEY,
                    user_id TEXT NOT NULL,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS oauth_states (
                    state TEXT PRIMARY KEY,
                    provider TEXT NOT NULL,
                    redirect_path TEXT,
                    expires_at TEXT NOT NULL,
                    created_at TEXT NOT NULL
                )
                """
            )
            self._ensure_column(connection, "logs", "original_model", "TEXT")
            self._ensure_column(connection, "logs", "user_id", "TEXT")
            self._ensure_column(connection, "logs", "request_count", "INTEGER")
            self._ensure_column(connection, "logs", "session_id", "TEXT")
            self._ensure_column(connection, "logs", "request_source", "TEXT")
            self._ensure_column(connection, "logs", "selected_model", "TEXT")
            self._ensure_column(connection, "logs", "actual_model", "TEXT")
            self._ensure_column(connection, "logs", "model_display_name", "TEXT")
            self._ensure_column(connection, "logs", "provider", "TEXT")
            self._ensure_column(connection, "logs", "is_free_model", "INTEGER NOT NULL DEFAULT 0")
            self._ensure_column(connection, "logs", "model_source", "TEXT")
            self._ensure_column(connection, "logs", "routing_reason", "TEXT")
            self._ensure_column(connection, "logs", "routing_score", "REAL")
            self._ensure_column(connection, "logs", "status_code", "INTEGER")
            self._ensure_column(connection, "logs", "fallback_used", "INTEGER NOT NULL DEFAULT 0")
            self._ensure_column(connection, "logs", "estimated_cost", "REAL NOT NULL DEFAULT 0")
            self._ensure_column(connection, "users", "is_superuser", "INTEGER NOT NULL DEFAULT 0")
            self._rename_legacy_model_column(connection)
            connection.commit()

    @staticmethod
    def _ensure_column(
        connection: sqlite3.Connection,
        table_name: str,
        column_name: str,
        column_type: str,
    ) -> None:
        existing_columns = {
            row["name"]
            for row in connection.execute(f"PRAGMA table_info({table_name})").fetchall()
        }
        if column_name not in existing_columns:
            connection.execute(
                f"ALTER TABLE {table_name} ADD COLUMN {column_name} {column_type}"
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
        user_id: str | None,
        request_count: int | None,
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
            user_id,
            request_count,
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
        user_id: str | None,
        request_count: int | None,
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
                    user_id,
                    request_count,
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
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    datetime.now(timezone.utc).isoformat(),
                    user_id,
                    request_count,
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

    async def create_user(
        self,
        *,
        user_id: str,
        email: str,
        name: str,
        password_hash: str | None,
        plan: str = "free",
        is_superuser: bool = False,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(self._create_user_sync, user_id, email, name, password_hash, plan, is_superuser)

    def _create_user_sync(
        self,
        user_id: str,
        email: str,
        name: str,
        password_hash: str | None,
        plan: str,
        is_superuser: bool,
    ) -> dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO users (id, email, name, password_hash, plan, is_superuser, requests_today, last_updated, created_at)
                VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
                """,
                (user_id, email.lower(), name, password_hash, plan, int(is_superuser), now, now),
            )
            connection.commit()
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else {}

    async def get_user_by_email(self, email: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._get_user_by_email_sync, email)

    def _get_user_by_email_sync(self, email: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM users WHERE email = ?", (email.lower(),)).fetchone()
        return dict(row) if row else None

    async def get_user_by_id(self, user_id: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._get_user_by_id_sync, user_id)

    def _get_user_by_id_sync(self, user_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None

    async def get_or_create_oauth_user(
        self,
        *,
        provider: str,
        provider_user_id: str,
        email: str,
        name: str,
    ) -> dict[str, Any]:
        return await asyncio.to_thread(self._get_or_create_oauth_user_sync, provider, provider_user_id, email.lower(), name)

    def _get_or_create_oauth_user_sync(
        self,
        provider: str,
        provider_user_id: str,
        email: str,
        name: str,
    ) -> dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            linked = connection.execute(
                """
                SELECT u.*
                FROM oauth_accounts oa
                JOIN users u ON u.id = oa.user_id
                WHERE oa.provider = ? AND oa.provider_user_id = ?
                """,
                (provider, provider_user_id),
            ).fetchone()
            if linked:
                return dict(linked)

            existing_user = connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            if existing_user:
                user_id = existing_user["id"]
                connection.execute(
                    """
                    INSERT OR IGNORE INTO oauth_accounts (provider, provider_user_id, user_id, created_at)
                    VALUES (?, ?, ?, ?)
                    """,
                    (provider, provider_user_id, user_id, now),
                )
                connection.commit()
                return dict(existing_user)

            user_id = f"user_{os.urandom(8).hex()}"
            connection.execute(
                """
                INSERT INTO users (id, email, name, password_hash, plan, is_superuser, requests_today, last_updated, created_at)
                VALUES (?, ?, ?, NULL, 'free', 0, 0, ?, ?)
                """,
                (user_id, email, name, now, now),
            )
            connection.execute(
                """
                INSERT INTO oauth_accounts (provider, provider_user_id, user_id, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (provider, provider_user_id, user_id, now),
            )
            connection.commit()
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else {}

    async def create_session(self, *, token_hash: str, user_id: str, expires_at: str) -> None:
        await asyncio.to_thread(self._create_session_sync, token_hash, user_id, expires_at)

    def _create_session_sync(self, token_hash: str, user_id: str, expires_at: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
            connection.execute(
                """
                INSERT INTO sessions (token_hash, user_id, expires_at, created_at)
                VALUES (?, ?, ?, ?)
                """,
                (token_hash, user_id, expires_at, now),
            )
            connection.commit()

    async def get_user_by_session_token_hash(self, token_hash: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._get_user_by_session_token_hash_sync, token_hash)

    def _get_user_by_session_token_hash_sync(self, token_hash: str) -> dict[str, Any] | None:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (now,))
            row = connection.execute(
                """
                SELECT u.*
                FROM sessions s
                JOIN users u ON u.id = s.user_id
                WHERE s.token_hash = ? AND s.expires_at > ?
                """,
                (token_hash, now),
            ).fetchone()
            connection.commit()
        return dict(row) if row else None

    async def delete_session(self, token_hash: str) -> None:
        await asyncio.to_thread(self._delete_session_sync, token_hash)

    def _delete_session_sync(self, token_hash: str) -> None:
        with self._connect() as connection:
            connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
            connection.commit()

    async def store_oauth_state(self, *, state: str, provider: str, redirect_path: str | None, expires_at: str) -> None:
        await asyncio.to_thread(self._store_oauth_state_sync, state, provider, redirect_path, expires_at)

    def _store_oauth_state_sync(self, state: str, provider: str, redirect_path: str | None, expires_at: str) -> None:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            connection.execute("DELETE FROM oauth_states WHERE expires_at <= ?", (now,))
            connection.execute(
                """
                INSERT INTO oauth_states (state, provider, redirect_path, expires_at, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (state, provider, redirect_path, expires_at, now),
            )
            connection.commit()

    async def consume_oauth_state(self, *, state: str, provider: str) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._consume_oauth_state_sync, state, provider)

    def _consume_oauth_state_sync(self, state: str, provider: str) -> dict[str, Any] | None:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            connection.execute("DELETE FROM oauth_states WHERE expires_at <= ?", (now,))
            row = connection.execute(
                """
                SELECT * FROM oauth_states
                WHERE state = ? AND provider = ? AND expires_at > ?
                """,
                (state, provider, now),
            ).fetchone()
            if row:
                connection.execute("DELETE FROM oauth_states WHERE state = ?", (state,))
            connection.commit()
        return dict(row) if row else None

    async def consume_user_request(self, *, user_id: str, free_daily_limit: int) -> tuple[bool, dict[str, Any] | None]:
        return await asyncio.to_thread(self._consume_user_request_sync, user_id, free_daily_limit)

    def _consume_user_request_sync(self, user_id: str, free_daily_limit: int) -> tuple[bool, dict[str, Any] | None]:
        today = datetime.now(timezone.utc).date().isoformat()
        with self._connect() as connection:
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
            if row is None:
                return False, None
            user = dict(row)
            requests_today = int(user["requests_today"] or 0)
            if user["last_updated"][:10] != today:
                requests_today = 0
            if user["plan"] != "pro" and requests_today >= free_daily_limit:
                updated = {
                    **user,
                    "requests_today": requests_today,
                    "last_updated": today,
                }
                return False, updated

            requests_today += 1
            connection.execute(
                """
                UPDATE users
                SET requests_today = ?, last_updated = ?
                WHERE id = ?
                """,
                (requests_today, today, user_id),
            )
            connection.commit()
            user["requests_today"] = requests_today
            user["last_updated"] = today
        return True, user

    async def update_user_plan(self, *, user_id: str, plan: str, stripe_customer_id: str | None = None) -> dict[str, Any] | None:
        return await asyncio.to_thread(self._update_user_plan_sync, user_id, plan, stripe_customer_id)

    def _update_user_plan_sync(self, user_id: str, plan: str, stripe_customer_id: str | None) -> dict[str, Any] | None:
        with self._connect() as connection:
            connection.execute(
                """
                UPDATE users
                SET plan = ?, stripe_customer_id = COALESCE(?, stripe_customer_id)
                WHERE id = ?
                """,
                (plan, stripe_customer_id, user_id),
            )
            connection.commit()
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else None

    async def upsert_local_superuser(
        self,
        *,
        email: str,
        name: str,
        password_hash: str,
        plan: str = "pro",
    ) -> dict[str, Any]:
        return await asyncio.to_thread(self._upsert_local_superuser_sync, email.lower(), name, password_hash, plan)

    def _upsert_local_superuser_sync(
        self,
        email: str,
        name: str,
        password_hash: str,
        plan: str,
    ) -> dict[str, Any]:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            existing = connection.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
            if existing:
                connection.execute(
                    """
                    UPDATE users
                    SET name = ?, password_hash = ?, plan = ?, is_superuser = 1, last_updated = ?
                    WHERE email = ?
                    """,
                    (name, password_hash, plan, now, email),
                )
                user_id = existing["id"]
            else:
                user_id = f"user_{os.urandom(8).hex()}"
                connection.execute(
                    """
                    INSERT INTO users (id, email, name, password_hash, plan, is_superuser, requests_today, last_updated, created_at)
                    VALUES (?, ?, ?, ?, ?, 1, 0, ?, ?)
                    """,
                    (user_id, email, name, password_hash, plan, now, now),
                )
            connection.commit()
            row = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return dict(row) if row else {}

    def _get_recent_logs_sync(self, limit: int) -> list[sqlite3.Row]:
        with self._connect() as connection:
            cursor = connection.execute(
                """
                SELECT
                    id,
                    timestamp,
                    user_id,
                    request_count,
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
            user_id=row["user_id"],
            request_count=row["request_count"],
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
