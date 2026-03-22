from __future__ import annotations

import os
from pathlib import Path

import httpx
import pytest
import pytest_asyncio
from asgi_lifespan import LifespanManager

from app.mock_provider import app as mock_provider_app

os.environ["PROVIDER_BASE_URL"] = "http://mock-provider"
os.environ["PROVIDER_API_KEY"] = "local-test-key"
os.environ["OPENROUTER_BASE_URL"] = "http://mock-provider/api/v1"
os.environ["OPENROUTER_API_KEY"] = "local-openrouter-key"
os.environ["ENABLE_OPENROUTER"] = "true"
os.environ["ENV_MODE"] = "cloud"
os.environ["ENABLE_CLOUD_MODE"] = "true"
os.environ["ENABLE_MEMORY"] = "true"
os.environ["ENABLE_STYLE_LAYER"] = "true"
os.environ["ENABLE_PREMIUM_ROUTING"] = "true"
os.environ["OPENCLAW_MODELS"] = "custom/openclaw-model,meta-llama/llama-3.3-8b-instruct:free"
os.environ["CLAWHELM_DB_PATH"] = str(Path("test-clawhelm.db").resolve())
os.environ["CLAWHELM_SETTINGS_PATH"] = str(Path("test-clawhelm-settings.json").resolve())
os.environ["CHEAP_MODEL"] = "gpt-3.5-turbo-fail"
os.environ["MID_MODEL"] = "gpt-4o-mini"
os.environ["EXPENSIVE_MODEL"] = "gpt-4o"
os.environ["CHEAP_MODEL_COST_PER_1K_TOKENS"] = "0.5"
os.environ["MID_MODEL_COST_PER_1K_TOKENS"] = "1.0"
os.environ["EXPENSIVE_MODEL_COST_PER_1K_TOKENS"] = "5.0"

from app.main import app
from app.models_registry import model_registry
from app.proxy import extract_total_tokens
from app.router import get_ranked_route_decisions


@pytest.fixture(autouse=True)
def cleanup_test_db():
    db_path = Path(os.environ["CLAWHELM_DB_PATH"])
    settings_path = Path(os.environ["CLAWHELM_SETTINGS_PATH"])
    if db_path.exists():
        db_path.unlink()
    if settings_path.exists():
        settings_path.unlink()
    yield
    if db_path.exists():
        db_path.unlink()
    if settings_path.exists():
        settings_path.unlink()


@pytest_asyncio.fixture
async def test_client():
    async def mock_send(request: httpx.Request) -> httpx.Response:
        transport = httpx.ASGITransport(app=mock_provider_app)
        async with httpx.AsyncClient(transport=transport, base_url="http://mock-provider") as upstream_client:
            upstream_request = upstream_client.build_request(
                request.method,
                str(request.url),
                headers=request.headers,
                content=request.content,
            )
            return await upstream_client.send(upstream_request)

    async with LifespanManager(app):
        app.state.http_client = httpx.AsyncClient(transport=httpx.MockTransport(mock_send), timeout=30.0)
        await model_registry.refresh(app.state.http_client)
        async with httpx.AsyncClient(
            transport=httpx.ASGITransport(app=app),
            base_url="http://testserver",
        ) as client:
            yield client
        await app.state.http_client.aclose()


@pytest.mark.asyncio
async def test_chat_completions_proxy_and_logs(test_client: httpx.AsyncClient):
    response = await test_client.post(
        "/v1/chat/completions",
        json={
            "model": "user-requested-model",
            "messages": [{"role": "user", "content": "hello"}],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["id"] == "chatcmpl-mock-free"
    assert body["choices"][0]["message"]["content"] == "free:hello"
    assert body["usage"]["total_tokens"] == 11
    assert body["model"] == "meta-llama/llama-3.3-8b-instruct:free"

    logs_response = await test_client.get("/logs")
    assert logs_response.status_code == 200
    logs = logs_response.json()
    assert len(logs) == 1
    assert logs[0]["original_model"] == "user-requested-model"
    assert logs[0]["selected_model"] == "openrouter/free"
    assert logs[0]["actual_model"] == "meta-llama/llama-3.3-8b-instruct:free"
    assert logs[0]["model_display_name"] == "openrouter/free -> meta-llama/llama-3.3-8b-instruct:free"
    assert logs[0]["provider"] == "openrouter"
    assert logs[0]["request_source"] == "external"
    assert logs[0]["is_free_model"] is True
    assert logs[0]["model_source"] == "available_pool"
    assert logs[0]["routing_reason"] == "selected based on performance score"
    assert logs[0]["status_code"] == 200
    assert logs[0]["fallback_used"] is False
    assert "hello" in logs[0]["prompt"]
    assert logs[0]["response"] == "free:hello"
    assert logs[0]["total_tokens"] == 11
    assert logs[0]["estimated_cost"] == 0.0


@pytest.mark.asyncio
async def test_fallback_retries_with_more_powerful_model(test_client: httpx.AsyncClient):
    response = await test_client.post(
        "/v1/chat/completions",
        json={
            "model": "ignored-original-model",
            "messages": [{"role": "user", "content": "free-fail"}],
        },
    )

    assert response.status_code == 200
    body = response.json()
    assert body["model"] == "google/gemma-2-9b-it:free"

    logs_response = await test_client.get("/logs")
    logs = logs_response.json()
    assert len(logs) == 1
    assert logs[0]["original_model"] == "ignored-original-model"
    assert logs[0]["selected_model"] == "google/gemma-2-9b-it:free"
    assert logs[0]["actual_model"] == "google/gemma-2-9b-it:free"
    assert logs[0]["model_display_name"] == "google/gemma-2-9b-it:free"
    assert logs[0]["provider"] == "openrouter"
    assert logs[0]["routing_reason"] == "fallback escalation"
    assert logs[0]["status_code"] == 200
    assert logs[0]["fallback_used"] is True


@pytest.mark.asyncio
async def test_upstream_error_is_preserved_and_logged(test_client: httpx.AsyncClient):
    response = await test_client.post(
        "/v1/chat/completions",
        json={
            "model": "force-error",
            "messages": [{"role": "user", "content": ("x" * 1190) + "force-error"}],
        },
    )

    assert response.status_code == 429
    assert response.json()["detail"]["error"]["code"] == "rate_limit_exceeded"

    logs_response = await test_client.get("/logs")
    logs = logs_response.json()
    assert len(logs) == 1
    assert logs[0]["original_model"] == "force-error"
    assert logs[0]["provider"] in {"openrouter", "openai"}
    assert logs[0]["status_code"] == 429
    assert logs[0]["fallback_used"] is True


@pytest.mark.asyncio
async def test_refresh_models_and_stats(test_client: httpx.AsyncClient):
    refresh_response = await test_client.get("/refresh-models")
    assert refresh_response.status_code == 200
    refresh_body = refresh_response.json()
    assert "openrouter/free" in refresh_body["free_models"]
    assert "meta-llama/llama-3.3-8b-instruct:free" in refresh_body["free_models"]

    await test_client.post(
        "/v1/chat/completions",
        json={"model": "x", "messages": [{"role": "user", "content": "tiny"}]},
    )
    await test_client.post(
        "/v1/chat/completions",
        json={"model": "x", "messages": [{"role": "user", "content": "y" * 300}]},
    )

    stats_response = await test_client.get("/stats")
    assert stats_response.status_code == 200
    stats = stats_response.json()
    assert stats["total_requests"] == 2
    assert stats["successful_requests"] == 2
    assert stats["failed_requests"] == 0
    assert stats["fallback_count"] == 0
    assert stats["total_estimated_cost_usd"] >= 0
    assert stats["free_model_usage_count"] == 2
    assert stats["requests_using_free_models"] == 2
    assert stats["cost_saved_estimate"] > 0
    assert stats["requests_by_actual_model"]["meta-llama/llama-3.3-8b-instruct:free"] == 2
    assert stats["requests_by_provider"]["openrouter"] == 2
    assert stats["usage_by_provider"]["openrouter"] == 2
    assert "performance_by_model" in stats
    assert stats["performance_by_model"]["meta-llama/llama-3.3-8b-instruct:free"]["success_rate"] == 1.0


@pytest.mark.asyncio
async def test_available_models_exclude_openai_without_key(test_client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.setenv("PROVIDER_API_KEY", "")
    available_models = model_registry.get_available_models()

    assert available_models
    assert all(model["provider"] == "openrouter" for model in available_models)


@pytest.mark.asyncio
async def test_ranked_candidates_prefer_openrouter_free_on_cold_start(test_client: httpx.AsyncClient):
    ranked = get_ranked_route_decisions(registry=model_registry)

    assert ranked
    assert ranked[0].model == "openrouter/free"
    assert ranked[0].provider == "openrouter"


def test_extract_total_tokens_supports_multiple_usage_shapes():
    assert extract_total_tokens({"usage": {"total_tokens": 11}}) == 11
    assert extract_total_tokens({"usage": {"totalTokens": 12}}) == 12
    assert extract_total_tokens({"usage": {"prompt_tokens": 8, "completion_tokens": 3}}) == 11
    assert extract_total_tokens({"usage": {"input_tokens": 8, "output_tokens": 4}}) == 12
    assert extract_total_tokens({"usage": {"inputTokens": "9", "outputTokens": "5"}}) == 14


@pytest.mark.asyncio
async def test_provider_config_endpoint_persists_openrouter_key(test_client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch):
    monkeypatch.delenv("OPENROUTER_API_KEY", raising=False)

    response = await test_client.put("/config/providers/openrouter", json={"api_key": "or-test-123456"})
    assert response.status_code == 200
    payload = response.json()
    assert payload["providers"]["openrouter"]["configured"] is True
    assert payload["providers"]["openrouter"]["source"] == "settings"
    assert payload["providers"]["openrouter"]["masked_key"].startswith("or-t")

    health_response = await test_client.get("/health")
    assert health_response.status_code == 200
    assert health_response.json()["openrouter_key_configured"] is True


@pytest.mark.asyncio
async def test_dashboard_requests_are_labeled_in_logs(test_client: httpx.AsyncClient):
    response = await test_client.post(
        "/v1/chat/completions",
        headers={"X-ClawHelm-Client": "dashboard"},
        json={
            "model": "clawhelm-auto",
            "messages": [{"role": "user", "content": "source test"}],
        },
    )

    assert response.status_code == 200
    logs_response = await test_client.get("/logs")
    logs = logs_response.json()
    assert logs[0]["request_source"] == "dashboard"
