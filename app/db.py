from __future__ import annotations

import asyncio
import os
import sqlite3
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from .costs import estimate_cost_saved_for_free_request
from .models import LogEntry
from .performance import get_performance_by_model

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
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    provider_user_id TEXT,
                    provider TEXT NOT NULL DEFAULT 'email',
                    email TEXT NOT NULL UNIQUE,
                    name TEXT,
                    avatar_url TEXT,
                    password_hash TEXT,
                    created_at TEXT NOT NULL,
                    last_login_at TEXT
                )
                """
            )
            self._ensure_column(connection, "users", "password_hash", "TEXT")
            self._ensure_column(connection, "users", "provider_user_id", "TEXT")
            self._migrate_users_table(connection)
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS sessions (
                    id TEXT PRIMARY KEY,
                    user_id INTEGER NOT NULL,
                    created_at TEXT NOT NULL,
                    last_accessed_at TEXT NOT NULL,
                    title TEXT,
                    FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
                )
                """
            )
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS session_messages (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    session_id TEXT NOT NULL,
                    role TEXT NOT NULL,
                    content TEXT NOT NULL,
                    meta TEXT,
                    created_at TEXT NOT NULL,
                    FOREIGN KEY(session_id) REFERENCES sessions(id) ON DELETE CASCADE
                )
                """
            )
            self._ensure_column(connection, "logs", "user_id", "INTEGER")
            self._ensure_column(connection, "logs", "original_model", "TEXT")
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
            self._fix_legacy_columns(connection)
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
    def _fix_legacy_columns(connection: sqlite3.Connection) -> None:
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

    @staticmethod
    def _migrate_users_table(connection: sqlite3.Connection) -> None:
        # If provider_user_id is NOT NULL in old schema, recreate table with nullable constraint
        cols = connection.execute("PRAGMA table_info(users)").fetchall()
        pid_col = next((c for c in cols if c["name"] == "provider_user_id"), None)
        if pid_col and pid_col["notnull"]:
            connection.execute("ALTER TABLE users RENAME TO _users_old")
            connection.execute(
                """
                CREATE TABLE users (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    provider_user_id TEXT,
                    provider TEXT NOT NULL DEFAULT 'email',
                    email TEXT NOT NULL UNIQUE,
                    name TEXT,
                    avatar_url TEXT,
                    password_hash TEXT,
                    created_at TEXT NOT NULL,
                    last_login_at TEXT
                )
                """
            )
            connection.execute(
                """
                INSERT INTO users (id, provider_user_id, provider, email, name, avatar_url, created_at, last_login_at)
                SELECT id, provider_user_id, provider, email, name, avatar_url, created_at, last_login_at
                FROM _users_old
                """
            )
            connection.execute("DROP TABLE _users_old")

    async def insert_log(
        self,
        *,
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
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    datetime.now(timezone.utc).isoformat(),
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
            "candidate_scores": [],
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
    def _row_to_log_entry(row: sqlite3.Row) -> LogEntry:
        return LogEntry(
            id=row["id"],
            timestamp=datetime.fromisoformat(row["timestamp"]),
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

    async def get_or_create_user(
        self,
        provider: str,
        provider_user_id: str,
        email: str,
        name: str | None,
        avatar_url: str | None,
    ) -> dict:
        user = await asyncio.to_thread(
            self._get_or_create_user_sync,
            provider,
            provider_user_id,
            email,
            name,
            avatar_url,
        )
        return user

    def _get_or_create_user_sync(
        self,
        provider: str,
        provider_user_id: str,
        email: str,
        name: str | None,
        avatar_url: str | None,
    ) -> dict:
        with self._connect() as connection:
            cursor = connection.execute(
                "SELECT * FROM users WHERE provider = ? AND provider_user_id = ?",
                (provider, provider_user_id),
            )
            user = cursor.fetchone()
            if user:
                connection.execute(
                    "UPDATE users SET last_login_at = ? WHERE id = ?",
                    (datetime.now(timezone.utc).isoformat(), user["id"]),
                )
                connection.commit()
                return dict(user)

            cursor = connection.execute(
                """
                INSERT INTO users (provider, provider_user_id, email, name, avatar_url, created_at, last_login_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    provider,
                    provider_user_id,
                    email,
                    name,
                    avatar_url,
                    datetime.now(timezone.utc).isoformat(),
                    datetime.now(timezone.utc).isoformat(),
                ),
            )
            connection.commit()
            user_id = cursor.lastrowid
            cursor = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,))
            return dict(cursor.fetchone())

    async def get_user_by_email(self, email: str) -> dict | None:
        return await asyncio.to_thread(self._get_user_by_email_sync, email)

    def _get_user_by_email_sync(self, email: str) -> dict | None:
        with self._connect() as connection:
            cursor = connection.execute("SELECT * FROM users WHERE email = ?", (email,))
            row = cursor.fetchone()
            return dict(row) if row else None

    async def create_email_user(self, email: str, password_hash: str, name: str | None) -> dict:
        return await asyncio.to_thread(self._create_email_user_sync, email, password_hash, name)

    def _create_email_user_sync(self, email: str, password_hash: str, name: str | None) -> dict:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO users (provider, email, password_hash, name, created_at, last_login_at)
                VALUES ('email', ?, ?, ?, ?, ?)
                """,
                (email, password_hash, name, now, now),
            )
            connection.commit()
            cursor = connection.execute("SELECT * FROM users WHERE id = ?", (cursor.lastrowid,))
            return dict(cursor.fetchone())

    async def get_user_by_id(self, user_id: int) -> dict | None:
        user = await asyncio.to_thread(self._get_user_by_id_sync, user_id)
        return user

    def _get_user_by_id_sync(self, user_id: int) -> dict | None:
        with self._connect() as connection:
            cursor = connection.execute("SELECT * FROM users WHERE id = ?", (user_id,))
            row = cursor.fetchone()
            return dict(row) if row else None

    async def create_session(self, user_id: int, session_id: str, title: str | None = None) -> dict:
        session = await asyncio.to_thread(self._create_session_sync, user_id, session_id, title)
        return session

    def _create_session_sync(self, user_id: int, session_id: str, title: str | None = None) -> dict:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO sessions (id, user_id, created_at, last_accessed_at, title)
                VALUES (?, ?, ?, ?, ?)
                """,
                (session_id, user_id, now, now, title),
            )
            connection.commit()
            cursor = connection.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
            return dict(cursor.fetchone())

    async def get_user_sessions(self, user_id: int) -> list[dict]:
        sessions = await asyncio.to_thread(self._get_user_sessions_sync, user_id)
        return sessions

    def _get_user_sessions_sync(self, user_id: int) -> list[dict]:
        with self._connect() as connection:
            cursor = connection.execute(
                """
                SELECT s.id, s.title, s.created_at, s.last_accessed_at,
                       COUNT(sm.id) as message_count
                FROM sessions s
                LEFT JOIN session_messages sm ON s.id = sm.session_id
                WHERE s.user_id = ?
                GROUP BY s.id
                ORDER BY s.last_accessed_at DESC
                """,
                (user_id,),
            )
            return [dict(row) for row in cursor.fetchall()]

    async def get_session_messages(self, session_id: str) -> list[dict]:
        messages = await asyncio.to_thread(self._get_session_messages_sync, session_id)
        return messages

    def _get_session_messages_sync(self, session_id: str) -> list[dict]:
        with self._connect() as connection:
            cursor = connection.execute(
                """
                SELECT id, role, content, meta, created_at
                FROM session_messages
                WHERE session_id = ?
                ORDER BY id ASC
                """,
                (session_id,),
            )
            return [dict(row) for row in cursor.fetchall()]

    async def add_session_message(
        self,
        session_id: str,
        role: str,
        content: str,
        meta: dict | None = None,
    ) -> dict:
        import json
        message = await asyncio.to_thread(
            self._add_session_message_sync,
            session_id,
            role,
            content,
            json.dumps(meta) if meta else None,
        )
        return message

    def _add_session_message_sync(
        self,
        session_id: str,
        role: str,
        content: str,
        meta_json: str | None = None,
    ) -> dict:
        now = datetime.now(timezone.utc).isoformat()
        with self._connect() as connection:
            cursor = connection.execute(
                """
                INSERT INTO session_messages (session_id, role, content, meta, created_at)
                VALUES (?, ?, ?, ?, ?)
                """,
                (session_id, role, content, meta_json, now),
            )
            connection.execute(
                "UPDATE sessions SET last_accessed_at = ? WHERE id = ?",
                (now, session_id),
            )
            connection.commit()
            cursor = connection.execute(
                "SELECT id, role, content, meta, created_at FROM session_messages WHERE id = ?",
                (cursor.lastrowid,),
            )
            return dict(cursor.fetchone())

    async def update_session_title(self, session_id: str, title: str) -> dict:
        session = await asyncio.to_thread(self._update_session_title_sync, session_id, title)
        return session

    def _update_session_title_sync(self, session_id: str, title: str) -> dict:
        with self._connect() as connection:
            connection.execute(
                "UPDATE sessions SET title = ? WHERE id = ?",
                (title, session_id),
            )
            connection.commit()
            cursor = connection.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
            return dict(cursor.fetchone())

    async def delete_session(self, session_id: str) -> None:
        await asyncio.to_thread(self._delete_session_sync, session_id)

    def _delete_session_sync(self, session_id: str) -> None:
        with self._connect() as connection:
            connection.execute("DELETE FROM sessions WHERE id = ?", (session_id,))
            connection.commit()


db = Database()
