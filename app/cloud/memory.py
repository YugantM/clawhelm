from __future__ import annotations

from typing import Any

from .session import session_store


class MemoryStore:
    async def store_messages(self, session_id: str, messages: list[dict[str, Any]]) -> dict[str, Any]:
        return await session_store.append_messages(session_id, messages)

    async def get_recent_messages(self, session_id: str, limit: int = 12) -> list[dict[str, Any]]:
        session = await session_store.get_session(session_id)
        if not session:
            return []
        messages = session.get("messages", [])
        return messages[-limit:]

    async def update_summary(self, session_id: str, summary: str | None) -> dict[str, Any]:
        return await session_store.set_summary(session_id, summary)

    async def get_session_payload(self, session_id: str) -> dict[str, Any] | None:
        return await session_store.get_session(session_id)


memory_store = MemoryStore()

