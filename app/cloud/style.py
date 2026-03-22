from __future__ import annotations

from typing import Any


default_style = {
    "tone": "concise",
    "format": "structured",
}

STYLE_PROMPT = "You are a concise assistant. Keep responses structured and clear."


def apply_style_layer(messages: list[dict[str, Any]] | None) -> list[dict[str, Any]]:
    base_messages = list(messages or [])
    if base_messages and base_messages[0].get("role") == "system" and base_messages[0].get("content") == STYLE_PROMPT:
        return base_messages
    return [{"role": "system", "content": STYLE_PROMPT}, *base_messages]

