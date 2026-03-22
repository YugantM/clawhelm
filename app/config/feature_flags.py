from __future__ import annotations

import os


def _env_flag(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default).lower()).strip().lower() in {"1", "true", "yes", "on"}


ENV_MODE = os.getenv("ENV_MODE", "local").strip().lower() or "local"
ENABLE_CLOUD_MODE = _env_flag("ENABLE_CLOUD_MODE", ENV_MODE == "cloud")
ENABLE_MEMORY = _env_flag("ENABLE_MEMORY", ENV_MODE == "cloud")
ENABLE_STYLE_LAYER = _env_flag("ENABLE_STYLE_LAYER", ENV_MODE == "cloud")
ENABLE_PREMIUM_ROUTING = _env_flag("ENABLE_PREMIUM_ROUTING", ENV_MODE == "cloud")


def is_cloud_mode() -> bool:
    return ENV_MODE == "cloud" and ENABLE_CLOUD_MODE

