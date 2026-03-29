from __future__ import annotations

import os
from dataclasses import dataclass
from typing import Any


@dataclass(slots=True)
class ProviderConfig:
    name: str
    base_url_env: str
    base_url_default: str
    chat_path: str
    models_path: str | None
    api_key_env: str
    enabled_env: str
    enabled_default: bool = True
    supports_free: bool = False


class ProviderRegistry:
    def __init__(self) -> None:
        self._providers: dict[str, ProviderConfig] = {}

    def register(self, config: ProviderConfig) -> None:
        self._providers[config.name] = config

    def get(self, name: str) -> ProviderConfig | None:
        return self._providers.get(name)

    def all_names(self) -> list[str]:
        return list(self._providers.keys())

    def get_base_url(self, name: str) -> str:
        config = self._providers.get(name)
        if config is None:
            raise ValueError(f"Unknown provider: {name}")
        return os.getenv(config.base_url_env, config.base_url_default).rstrip("/")

    def get_api_key(self, name: str) -> str | None:
        config = self._providers.get(name)
        if config is None:
            return None
        env_value = os.getenv(config.api_key_env, "").strip()
        if env_value:
            return env_value
        # Fallback to settings store (lazy import to avoid circular dependency)
        from .settings import settings_store
        return settings_store.get_provider_api_key(name)

    def is_enabled(self, name: str) -> bool:
        config = self._providers.get(name)
        if config is None:
            return False
        has_key = bool(self.get_api_key(name))
        env_flag = os.getenv(config.enabled_env, str(config.enabled_default)).lower() == "true"
        return has_key and env_flag

    def get_enabled(self) -> list[ProviderConfig]:
        return [cfg for cfg in self._providers.values() if self.is_enabled(cfg.name)]


provider_registry = ProviderRegistry()

provider_registry.register(ProviderConfig(
    name="openrouter",
    base_url_env="OPENROUTER_BASE_URL",
    base_url_default="https://openrouter.ai/api/v1",
    chat_path="/chat/completions",
    models_path="/models",
    api_key_env="OPENROUTER_API_KEY",
    enabled_env="ALLOW_OPENROUTER_ROUTING",
    enabled_default=True,
    supports_free=True,
))

provider_registry.register(ProviderConfig(
    name="openai",
    base_url_env="PROVIDER_BASE_URL",
    base_url_default="https://api.openai.com",
    chat_path="/v1/chat/completions",
    models_path=None,
    api_key_env="PROVIDER_API_KEY",
    enabled_env="ALLOW_OPENAI_ROUTING",
    enabled_default=True,
    supports_free=False,
))

provider_registry.register(ProviderConfig(
    name="groq",
    base_url_env="GROQ_BASE_URL",
    base_url_default="https://api.groq.com/openai/v1",
    chat_path="/chat/completions",
    models_path="/models",
    api_key_env="GROQ_API_KEY",
    enabled_env="ALLOW_GROQ_ROUTING",
    enabled_default=True,
    supports_free=False,
))
