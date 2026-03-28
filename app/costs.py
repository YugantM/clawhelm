from __future__ import annotations

import os

OPENROUTER_FREE_ROUTER = "openrouter/free"


def get_cheap_model() -> str:
    return os.getenv("CHEAP_MODEL", "gpt-3.5-turbo")


def get_mid_model() -> str:
    return os.getenv("MID_MODEL", "gpt-4o-mini")


def get_expensive_model() -> str:
    return os.getenv("EXPENSIVE_MODEL", "gpt-4o")


def _env_float(name: str, default: float) -> float:
    try:
        return float(os.getenv(name, default))
    except ValueError:
        return default


def get_model_rate_per_1k(model: str) -> float:
    if model == OPENROUTER_FREE_ROUTER or model.endswith(":free"):
        return 0.0

    # Try real pricing from registry metadata
    from .models_registry import model_registry
    model_info = model_registry.get_model(model)
    if model_info and (model_info.prompt_cost > 0 or model_info.completion_cost > 0):
        avg_per_token = (model_info.prompt_cost + model_info.completion_cost) / 2
        return avg_per_token * 1000

    # Fallback to hardcoded tiers
    if model == get_cheap_model():
        return _env_float("CHEAP_MODEL_COST_PER_1K_TOKENS", 0.5)
    if model == get_mid_model():
        return _env_float("MID_MODEL_COST_PER_1K_TOKENS", 1.0)
    if model == get_expensive_model():
        return _env_float("EXPENSIVE_MODEL_COST_PER_1K_TOKENS", 5.0)
    return _env_float("DEFAULT_MODEL_COST_PER_1K_TOKENS", 1.0)


def estimate_cost(model: str | None, total_tokens: int | None) -> float:
    if not model:
        return 0.0
    if total_tokens is None:
        return 0.0
    return round((total_tokens / 1000.0) * get_model_rate_per_1k(model), 6)


def estimate_cost_saved_for_free_request(total_tokens: int | None) -> float:
    if total_tokens is None:
        return 0.0
    baseline_model = get_cheap_model()
    return estimate_cost(baseline_model, total_tokens)
