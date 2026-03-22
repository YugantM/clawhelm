from __future__ import annotations

import asyncio
import os
from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from typing import Any

import httpx

from .performance import get_successful_models
from .settings import settings_store


@dataclass(slots=True)
class ModelInfo:
    id: str
    provider: str
    is_free: bool
    source: str


class ModelRegistry:
    def __init__(self) -> None:
        self._models: dict[str, ModelInfo] = {}
        self._last_refresh_at: datetime | None = None
        self._lock = asyncio.Lock()
        self._load_static_and_config_models()

    def _load_static_and_config_models(self) -> None:
        self._models = {}
        self._register_model("gpt-3.5-turbo", provider="openai", is_free=False, source="static")
        self._register_model("gpt-4o-mini", provider="openai", is_free=False, source="static")
        self._register_model("gpt-4o", provider="openai", is_free=False, source="static")
        self._register_model("openrouter/free", provider="openrouter", is_free=True, source="static")

        for model_id in self._split_env_models("OPENCLAW_MODELS"):
            self._register_model(
                model_id,
                provider=self._infer_provider(model_id),
                is_free=model_id.endswith(":free") or model_id == "openrouter/free",
                source="config",
            )

        for env_name in ("CHEAP_MODEL", "MID_MODEL", "EXPENSIVE_MODEL"):
            model_id = os.getenv(env_name)
            if model_id:
                self._register_model(
                    model_id,
                    provider=self._infer_provider(model_id),
                    is_free=model_id.endswith(":free") or model_id == "openrouter/free",
                    source="config",
                )

    @staticmethod
    def _split_env_models(env_name: str) -> list[str]:
        value = os.getenv(env_name, "")
        return [model.strip() for model in value.split(",") if model.strip()]

    @staticmethod
    def _infer_provider(model_id: str) -> str:
        if model_id.startswith("openrouter/") or model_id.endswith(":free"):
            return "openrouter"
        return "openai"

    def _register_model(self, model_id: str, *, provider: str, is_free: bool, source: str) -> None:
        self._models[model_id] = ModelInfo(
            id=model_id,
            provider=provider,
            is_free=is_free,
            source=source,
        )

    def get_model(self, model_id: str) -> ModelInfo | None:
        if model_id in self._models:
            return self._models[model_id]
        if model_id.endswith(":free"):
            return ModelInfo(id=model_id, provider="openrouter", is_free=True, source="fetched")
        return None

    def get_available_models(self) -> list[dict[str, Any]]:
        available: dict[str, dict[str, Any]] = {}

        if self._openai_enabled():
            for model in self._models.values():
                if model.provider == "openai":
                    available[model.id] = self._to_available_dict(model)

        if self._openrouter_enabled():
            for model in self._models.values():
                if model.provider == "openrouter":
                    available[model.id] = self._to_available_dict(model)

        for successful_model in get_successful_models():
            provider = successful_model["provider"]
            if provider == "openai" and not self._openai_enabled():
                continue
            if provider == "openrouter" and not self._openrouter_enabled():
                continue
            available[successful_model["model_id"]] = {
                "provider": provider,
                "model_id": successful_model["model_id"],
                "is_free": successful_model["is_free"],
                "enabled": True,
            }

        return list(available.values())

    def has_free_models(self) -> bool:
        return any(model["is_free"] for model in self.get_available_models())

    def get_free_models(self) -> list[dict[str, Any]]:
        return [model for model in self.get_available_models() if model["is_free"]]

    def snapshot(self) -> dict[str, Any]:
        free_models = sorted(model["model_id"] for model in self.get_free_models())
        return {
            "total_models": len(self._models),
            "available_models": self.get_available_models(),
            "free_models": free_models,
            "last_refresh_at": self._last_refresh_at.isoformat() if self._last_refresh_at else None,
            "models": [asdict(model) for model in sorted(self._models.values(), key=lambda item: item.id)],
        }

    async def refresh(self, client: httpx.AsyncClient) -> dict[str, Any]:
        async with self._lock:
            self._load_static_and_config_models()
            if self._openrouter_enabled():
                await self._fetch_openrouter_models(client)
            self._last_refresh_at = datetime.now(timezone.utc)
            return self.snapshot()

    async def _fetch_openrouter_models(self, client: httpx.AsyncClient) -> None:
        api_key = settings_store.get_provider_api_key("openrouter")
        if not api_key:
            return

        base_url = os.getenv("OPENROUTER_BASE_URL", "https://openrouter.ai/api/v1").rstrip("/")
        response = await client.get(
            f"{base_url}/models",
            headers={"authorization": f"Bearer {api_key}"},
        )
        response.raise_for_status()
        payload = response.json()
        data = payload.get("data", []) if isinstance(payload, dict) else []
        for item in data:
            if not isinstance(item, dict):
                continue
            model_id = item.get("id")
            if not isinstance(model_id, str):
                continue
            self._register_model(
                model_id,
                provider="openrouter",
                is_free=model_id.endswith(":free"),
                source="fetched",
            )

    @staticmethod
    def _to_available_dict(model: ModelInfo) -> dict[str, Any]:
        return {
            "provider": model.provider,
            "model_id": model.id,
            "is_free": model.is_free,
            "enabled": True,
        }

    @staticmethod
    def _openai_enabled() -> bool:
        return bool(settings_store.get_provider_api_key("openai")) and os.getenv("ALLOW_OPENAI_ROUTING", "true").lower() == "true"

    @staticmethod
    def _openrouter_enabled() -> bool:
        return bool(settings_store.get_provider_api_key("openrouter")) and os.getenv("ALLOW_OPENROUTER_ROUTING", "true").lower() == "true"


model_registry = ModelRegistry()
