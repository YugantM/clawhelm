from __future__ import annotations

import json
import os
from typing import Any

DEFAULT_CHAT_MODEL_OPTIONS: list[dict[str, Any]] = [
    {"id": "auto", "label": "Auto", "model_id": None, "endpoint": "/chat", "is_free": False, "recommended": True},
    {"id": "deepseek", "label": "DeepSeek", "model_id": "deepseek/deepseek-chat:free", "endpoint": "/chat", "is_free": True, "recommended": False},
    {"id": "mistral", "label": "Mistral", "model_id": "mistralai/mistral-7b-instruct:free", "endpoint": "/chat", "is_free": True, "recommended": False},
    {"id": "openchat", "label": "OpenChat", "model_id": "openchat/openchat-7b:free", "endpoint": "/chat", "is_free": True, "recommended": False},
]


def _normalize_option(item: Any) -> dict[str, Any] | None:
    if not isinstance(item, dict):
        return None
    option_id = item.get("id")
    label = item.get("label")
    endpoint = item.get("endpoint")
    if not isinstance(option_id, str) or not option_id.strip():
        return None
    if not isinstance(label, str) or not label.strip():
        return None
    if not isinstance(endpoint, str) or not endpoint.strip():
        return None
    model_id = item.get("model_id")
    if model_id is not None and not isinstance(model_id, str):
        return None
    return {
        "id": option_id.strip(),
        "label": label.strip(),
        "model_id": model_id.strip() if isinstance(model_id, str) else None,
        "endpoint": endpoint.strip(),
        "is_free": bool(item.get("is_free", False)),
        "recommended": bool(item.get("recommended", False)),
    }


def get_chat_model_options() -> list[dict[str, Any]]:
    raw = os.getenv("CHAT_MODEL_OPTIONS_JSON", "").strip()
    if not raw:
        return list(DEFAULT_CHAT_MODEL_OPTIONS)

    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return list(DEFAULT_CHAT_MODEL_OPTIONS)

    if not isinstance(parsed, list):
        return list(DEFAULT_CHAT_MODEL_OPTIONS)

    normalized: list[dict[str, Any]] = []
    for item in parsed:
        option = _normalize_option(item)
        if option is None:
            continue
        normalized.append(option)

    if not normalized:
        return list(DEFAULT_CHAT_MODEL_OPTIONS)

    if not any(option["id"] == "auto" for option in normalized):
        normalized.insert(0, dict(DEFAULT_CHAT_MODEL_OPTIONS[0]))

    return normalized


def get_chat_model_alias_map() -> dict[str, str]:
    aliases: dict[str, str] = {}
    for option in get_chat_model_options():
        option_id = option["id"]
        model_id = option.get("model_id")
        if option_id == "auto" or not isinstance(model_id, str) or not model_id:
            continue
        aliases[option_id] = model_id
    return aliases
