from __future__ import annotations

import asyncio
from copy import deepcopy
from typing import Any
from uuid import uuid4


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, dict[str, Any]] = {}
        self._lock = asyncio.Lock()

    async def ensure_session(
        self,
        session_id: str | None,
        *,
        style_profile: dict[str, Any] | None = None,
        metadata: dict[str, Any] | None = None,
    ) -> dict[str, Any]:
        async with self._lock:
            resolved_session_id = session_id or str(uuid4())
            session = self._sessions.setdefault(
                resolved_session_id,
                {
                    "session_id": resolved_session_id,
                    "messages": [],
                    "style_profile": style_profile or {},
                    "metadata": metadata or {},
                    "summary": None,
                },
            )
            if style_profile:
                session["style_profile"] = style_profile
            if metadata:
                session["metadata"] = {**session.get("metadata", {}), **metadata}
            return deepcopy(session)

    async def append_messages(self, session_id: str, messages: list[dict[str, Any]]) -> dict[str, Any]:
        async with self._lock:
            session = self._sessions.setdefault(
                session_id,
                {
                    "session_id": session_id,
                    "messages": [],
                    "style_profile": {},
                    "metadata": {},
                    "summary": None,
                },
            )
            session["messages"].extend(deepcopy(messages))
            return deepcopy(session)

    async def set_summary(self, session_id: str, summary: str | None) -> dict[str, Any]:
        async with self._lock:
            session = self._sessions.setdefault(
                session_id,
                {
                    "session_id": session_id,
                    "messages": [],
                    "style_profile": {},
                    "metadata": {},
                    "summary": None,
                },
            )
            session["summary"] = summary
            return deepcopy(session)

    async def get_session(self, session_id: str) -> dict[str, Any] | None:
        async with self._lock:
            session = self._sessions.get(session_id)
            return deepcopy(session) if session else None


session_store = SessionStore()

