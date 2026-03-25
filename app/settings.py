from __future__ import annotations

import asyncio
import json
import os
from pathlib import Path
from typing import Any


DEFAULT_SETTINGS_PATH = Path(__file__).resolve().parent.parent / ".clawhelm" / "settings.json"
SETTINGS_PATH = Path(os.getenv("CLAWHELM_SETTINGS_PATH", str(DEFAULT_SETTINGS_PATH))).expanduser().resolve()


def _mask_api_key(value: str | None) -> str | None:
    if not value:
        return None
    if len(value) <= 8:
        return "*" * len(value)
    return f"{value[:4]}{'*' * max(len(value) - 8, 4)}{value[-4:]}"


class SettingsStore:
    def __init__(self, path: Path = SETTINGS_PATH) -> None:
        self.path = path
        self._lock = asyncio.Lock()

    def _default_settings(self) -> dict[str, Any]:
        return {"providers": {"openrouter": {"api_key": ""}, "openai": {"api_key": ""}}}

    def _read_sync(self) -> dict[str, Any]:
        if not self.path.exists():
            return self._default_settings()
        try:
            data = json.loads(self.path.read_text())
        except (OSError, json.JSONDecodeError):
            return self._default_settings()
        if not isinstance(data, dict):
            return self._default_settings()
        providers = data.setdefault("providers", {})
        if not isinstance(providers, dict):
            data["providers"] = {}
            providers = data["providers"]
        providers.setdefault("openrouter", {"api_key": ""})
        providers.setdefault("openai", {"api_key": ""})
        return data

    def _write_sync(self, payload: dict[str, Any]) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.path.write_text(json.dumps(payload, indent=2) + "\n")

    async def get_provider_view(self) -> dict[str, Any]:
        return await asyncio.to_thread(self._get_provider_view_sync)

    def _get_provider_view_sync(self) -> dict[str, Any]:
        payload = self._read_sync()
        providers = payload.get("providers", {})
        result: dict[str, Any] = {}
        for provider_name in ("openrouter", "openai"):
            env_name = "OPENROUTER_API_KEY" if provider_name == "openrouter" else "PROVIDER_API_KEY"
            env_value = os.getenv(env_name, "").strip()
            stored_value = str(providers.get(provider_name, {}).get("api_key", "")).strip()
            active_value = env_value or stored_value or ""
            result[provider_name] = {
                "configured": bool(active_value),
                "source": "configured" if active_value else "missing",
            }
        return {
            "providers": result,
        }

    def get_provider_api_key(self, provider_name: str) -> str | None:
        env_name = "OPENROUTER_API_KEY" if provider_name == "openrouter" else "PROVIDER_API_KEY"
        env_value = os.getenv(env_name, "").strip()
        if env_value:
            return env_value
        payload = self._read_sync()
        stored_value = str(payload.get("providers", {}).get(provider_name, {}).get("api_key", "")).strip()
        return stored_value or None

    async def set_provider_api_key(self, provider_name: str, api_key: str) -> dict[str, Any]:
        async with self._lock:
            return await asyncio.to_thread(self._set_provider_api_key_sync, provider_name, api_key)

    def _set_provider_api_key_sync(self, provider_name: str, api_key: str) -> dict[str, Any]:
        payload = self._read_sync()
        payload.setdefault("providers", {})
        payload["providers"].setdefault(provider_name, {})
        payload["providers"][provider_name]["api_key"] = api_key.strip()
        self._write_sync(payload)
        return self._get_provider_view_sync()


settings_store = SettingsStore()
