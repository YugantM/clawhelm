from __future__ import annotations

import asyncio
import os
from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from typing import Any

import httpx

from .settings import settings_store
from .performance import get_successful_models


@dataclass(slots=True)
class ModelInfo:
    id: str
    provider: str
    is_free: bool
    source: str
    base_model: str = ""
    prompt_cost: float = 0.0
    completion_cost: float = 0.0
    context_length: int = 4096
    max_completion_tokens: int = 0
    modality: str = "text->text"
    display_name: str = ""


def _normalize_base_model(model_id: str) -> str:
    """Strip :free suffix to get the canonical base model name."""
    return model_id.split(":")[0]


def _parse_float(value: Any, default: float = 0.0) -> float:
    if value is None:
        return default
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


class ModelRegistry:
    def __init__(self) -> None:
        self._models: dict[str, ModelInfo] = {}
        self._by_base_model: dict[str, list[ModelInfo]] = {}
        self._last_refresh_at: datetime | None = None
        self._lock = asyncio.Lock()
        self._load_static_and_config_models()

    def _load_static_and_config_models(self) -> None:
        self._models = {}
        self._by_base_model = {}
        self._register_model("openrouter/free", provider="openrouter", is_free=True, source="static")

        for model_id in self._split_env_models("OPENCLAW_MODELS"):
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

    def _register_model(
        self,
        model_id: str,
        *,
        provider: str,
        is_free: bool,
        source: str,
        prompt_cost: float = 0.0,
        completion_cost: float = 0.0,
        context_length: int = 4096,
        max_completion_tokens: int = 0,
        modality: str = "text->text",
        display_name: str = "",
    ) -> None:
        base_model = _normalize_base_model(model_id)
        info = ModelInfo(
            id=model_id,
            provider=provider,
            is_free=is_free,
            source=source,
            base_model=base_model,
            prompt_cost=prompt_cost,
            completion_cost=completion_cost,
            context_length=context_length,
            max_completion_tokens=max_completion_tokens,
            modality=modality,
            display_name=display_name or model_id,
        )
        self._models[model_id] = info
        self._by_base_model.setdefault(base_model, [])
        # Replace existing entry from same provider, or append
        self._by_base_model[base_model] = [
            m for m in self._by_base_model[base_model] if not (m.id == model_id and m.provider == provider)
        ]
        self._by_base_model[base_model].append(info)

    def get_model(self, model_id: str) -> ModelInfo | None:
        if model_id in self._models:
            return self._models[model_id]
        if model_id.endswith(":free"):
            return ModelInfo(
                id=model_id, provider="openrouter", is_free=True, source="fetched",
                base_model=_normalize_base_model(model_id), display_name=model_id,
            )
        return None

    def get_providers_for_base_model(self, base_model: str) -> list[ModelInfo]:
        return self._by_base_model.get(base_model, [])

    def get_available_models(self) -> list[dict[str, Any]]:
        from .providers import provider_registry
        available: dict[str, dict[str, Any]] = {}

        for model in self._models.values():
            if provider_registry.is_enabled(model.provider):
                available[model.id] = self._to_available_dict(model)

        for successful_model in get_successful_models():
            provider = successful_model["provider"]
            if not provider_registry.is_enabled(provider):
                continue
            model_id = successful_model["model_id"]
            if model_id not in available:
                available[model_id] = {
                    "provider": provider,
                    "model_id": model_id,
                    "base_model": _normalize_base_model(model_id),
                    "is_free": successful_model["is_free"],
                    "enabled": True,
                    "display_name": model_id,
                    "prompt_cost": 0.0,
                    "completion_cost": 0.0,
                    "context_length": 4096,
                    "modality": "text->text",
                }

        return list(available.values())

    def snapshot(self) -> dict[str, Any]:
        free_models = sorted(model["model_id"] for model in self.get_available_models() if model["is_free"])
        return {
            "total_models": len(self._models),
            "available_models": self.get_available_models(),
            "free_models": free_models,
            "last_refresh_at": self._last_refresh_at.isoformat() if self._last_refresh_at else None,
            "models": [asdict(model) for model in sorted(self._models.values(), key=lambda item: item.id)],
        }

    async def refresh(self, client: httpx.AsyncClient) -> dict[str, Any]:
        from .providers import provider_registry
        async with self._lock:
            self._load_static_and_config_models()
            for config in provider_registry.get_enabled():
                if config.models_path and config.name == "openrouter":
                    await self._fetch_openrouter_models(client)
            self._last_refresh_at = datetime.now(timezone.utc)
            return self.snapshot()

    async def _fetch_openrouter_models(self, client: httpx.AsyncClient) -> None:
        from .providers import provider_registry
        api_key = provider_registry.get_api_key("openrouter")
        if not api_key:
            return

        base_url = provider_registry.get_base_url("openrouter")
        response = await client.get(f"{base_url}/models", headers={"authorization": f"Bearer {api_key}"})
        response.raise_for_status()
        payload = response.json()
        data = payload.get("data", []) if isinstance(payload, dict) else []
        for item in data:
            if not isinstance(item, dict):
                continue
            model_id = item.get("id")
            if not isinstance(model_id, str):
                continue

            # Extract metadata from OpenRouter API response
            pricing = item.get("pricing") or {}
            architecture = item.get("architecture") or {}
            top_provider = item.get("top_provider") or {}

            self._register_model(
                model_id,
                provider="openrouter",
                is_free=model_id.endswith(":free"),
                source="fetched",
                prompt_cost=_parse_float(pricing.get("prompt")),
                completion_cost=_parse_float(pricing.get("completion")),
                context_length=int(item.get("context_length") or 4096),
                max_completion_tokens=int(top_provider.get("max_completion_tokens") or 0),
                modality=str(architecture.get("modality") or "text->text"),
                display_name=str(item.get("name") or model_id).replace(" (free)", ""),
            )

    @staticmethod
    def _to_available_dict(model: ModelInfo) -> dict[str, Any]:
        return {
            "provider": model.provider,
            "model_id": model.id,
            "base_model": model.base_model,
            "is_free": model.is_free,
            "enabled": True,
            "display_name": model.display_name,
            "prompt_cost": model.prompt_cost,
            "completion_cost": model.completion_cost,
            "context_length": model.context_length,
            "modality": model.modality,
        }


model_registry = ModelRegistry()
