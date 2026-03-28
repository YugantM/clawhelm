"""
Automated backtesting scheduler for ClawHelm.

Sends standardized prompts to available models one-by-one,
measures latency and success, and stores results to improve routing.
Runs as a background asyncio task — never blocks the main app.
"""

from __future__ import annotations

import asyncio
import logging
import time
import uuid
from typing import Any

import httpx

from .db import db
from .models_registry import model_registry
from .providers import provider_registry

logger = logging.getLogger("clawhelm.backtest")

# ── Benchmark prompts (3 categories) ──────────────────────────
BENCHMARK_PROMPTS: dict[str, str] = {
    "short": "What is the capital of France? Answer in one sentence.",
    "code": "Write a Python function that checks if a string is a palindrome. Return just the code.",
    "analysis": "Name three advantages and three disadvantages of microservices architecture. Be concise.",
}

INTER_REQUEST_DELAY = 2.5   # seconds between API calls
REQUEST_TIMEOUT = 30.0      # per-model timeout
BACKTEST_INTERVAL = 3600.0  # re-run every 60 minutes
MAX_MODELS_PER_RUN = 80     # cap to avoid very long runs

# ── In-memory run state ───────────────────────────────────────
_current_run: dict[str, Any] = {
    "run_id": None,
    "status": "idle",       # idle | running | completed | failed
    "total": 0,
    "completed": 0,
    "last_completed_at": None,
}


def get_backtest_status() -> dict[str, Any]:
    return dict(_current_run)


# ── Core backtest logic ───────────────────────────────────────

async def _send_benchmark(
    client: httpx.AsyncClient,
    model_id: str,
    provider_name: str,
    prompt_category: str,
    prompt_text: str,
) -> dict[str, Any]:
    """Send a single benchmark request and return result dict."""
    provider_cfg = provider_registry.get(provider_name)
    if not provider_cfg:
        return {"status": "error", "latency": None, "tokens": None}

    api_key = provider_registry.get_api_key(provider_name)
    if not api_key:
        return {"status": "error", "latency": None, "tokens": None}

    base_url = provider_registry.get_base_url(provider_name)
    chat_path = provider_cfg.chat_path

    body = {
        "model": model_id,
        "messages": [{"role": "user", "content": prompt_text}],
        "max_tokens": 150,
        "stream": False,
    }

    start = time.monotonic()
    try:
        resp = await client.post(
            f"{base_url}{chat_path}",
            json=body,
            headers={
                "authorization": f"Bearer {api_key}",
                "content-type": "application/json",
            },
            timeout=REQUEST_TIMEOUT,
        )
        latency = time.monotonic() - start

        if resp.status_code < 400:
            data = resp.json()
            tokens = data.get("usage", {}).get("total_tokens")
            return {"status": "success", "latency": round(latency, 3), "tokens": tokens}
        else:
            return {"status": "error", "latency": round(latency, 3), "tokens": None}
    except (httpx.TimeoutException, httpx.ConnectError, Exception) as exc:
        latency = time.monotonic() - start
        logger.debug("Benchmark timeout/error for %s: %s", model_id, exc)
        return {"status": "timeout", "latency": round(latency, 3), "tokens": None}


async def run_backtest(client: httpx.AsyncClient, run_id: str | None = None) -> str:
    """Run a full backtest across all available models. Returns run_id."""
    if _current_run["status"] == "running":
        return _current_run["run_id"]

    run_id = run_id or str(uuid.uuid4())[:12]
    models = model_registry.get_available_models()[:MAX_MODELS_PER_RUN]
    total_tasks = len(models) * len(BENCHMARK_PROMPTS)

    _current_run.update(
        run_id=run_id, status="running", total=total_tasks, completed=0,
    )

    logger.info("Backtest %s started: %d models x %d prompts = %d tasks",
                run_id, len(models), len(BENCHMARK_PROMPTS), total_tasks)

    try:
        for model in models:
            model_id = model["model_id"]
            provider_name = model.get("provider", "openrouter")

            for category, prompt_text in BENCHMARK_PROMPTS.items():
                result = await _send_benchmark(
                    client, model_id, provider_name, category, prompt_text,
                )

                # Store result
                db.insert_benchmark_result(
                    run_id=run_id,
                    model_id=model_id,
                    provider=provider_name,
                    prompt_category=category,
                    latency=result["latency"],
                    status=result["status"],
                    tokens_used=result["tokens"],
                )

                _current_run["completed"] += 1

                # Throttle to avoid overwhelming the API
                await asyncio.sleep(INTER_REQUEST_DELAY)

        _current_run["status"] = "completed"
        _current_run["last_completed_at"] = time.time()
        logger.info("Backtest %s completed: %d/%d", run_id,
                     _current_run["completed"], total_tasks)

    except Exception as exc:
        _current_run["status"] = "failed"
        logger.error("Backtest %s failed: %s", run_id, exc)

    return run_id


# ── Scheduler (runs as background task) ───────────────────────

async def backtest_scheduler(client: httpx.AsyncClient) -> None:
    """Background loop: refresh models, then run backtest, repeat."""
    # Wait 15s after startup for things to settle
    await asyncio.sleep(15)

    while True:
        try:
            # Always refresh models before backtesting
            logger.info("Scheduler: refreshing models from OpenRouter...")
            await model_registry.refresh(client)
            models = model_registry.get_available_models()
            logger.info("Scheduler: %d models available", len(models))

            # Run backtest if we have models
            if models:
                await run_backtest(client)
        except Exception as exc:
            logger.error("Scheduler error: %s", exc)

        await asyncio.sleep(BACKTEST_INTERVAL)
