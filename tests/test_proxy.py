from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
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
os.environ["STRIPE_SECRET_KEY"] = "sk_test_123"
os.environ["STRIPE_PRICE_ID"] = "price_test_123"
os.environ["STRIPE_WEBHOOK_SECRET"] = "whsec_test_123"
os.environ["GOOGLE_CLIENT_ID"] = "google-client-id"
os.environ["GOOGLE_CLIENT_SECRET"] = "google-client-secret"
os.environ["GITHUB_CLIENT_ID"] = "github-client-id"
os.environ["GITHUB_CLIENT_SECRET"] = "github-client-secret"

import app.main as main_module
from app.main import app
from app.cloud.usage import FREE_DAILY_LIMIT, reset_usage_store
from app.models_registry import model_registry
from app.proxy import extract_total_tokens
from app.router import get_ranked_route_decisions


@pytest.fixture(autouse=True)
def cleanup_test_db():
    db_path = Path(os.environ["CLAWHELM_DB_PATH"])
    settings_path = Path(os.environ["CLAWHELM_SETTINGS_PATH"])
    reset_usage_store()
    if db_path.exists():
        db_path.unlink()
    if settings_path.exists():
        settings_path.unlink()
    yield
    reset_usage_store()
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


async def signup_user(
    test_client: httpx.AsyncClient,
    *,
    email: str = "user@example.com",
    password: str = "password123",
    name: str = "User",
):
    response = await test_client.post(
        "/auth/signup",
        json={"email": email, "password": password, "name": name},
    )
    assert response.status_code == 200
    return response.json()


def build_stripe_signature(body: bytes) -> str:
    timestamp = int(time.time())
    signed_payload = f"{timestamp}.{body.decode('utf-8')}".encode("utf-8")
    signature = hmac.new(
        os.environ["STRIPE_WEBHOOK_SECRET"].encode("utf-8"),
        signed_payload,
        hashlib.sha256,
    ).hexdigest()
    return f"t={timestamp},v1={signature}"


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


@pytest.mark.asyncio
async def test_chat_generates_user_id_and_returns_usage_metadata(test_client: httpx.AsyncClient):
    auth_user = await signup_user(test_client, email="usage@example.com")
    response = await test_client.post(
        "/chat",
        json={
            "message": "hello usage",
            "session_id": "usage-session-1",
        },
    )

    assert response.status_code == 200
    payload = response.json()
    assert payload["user_id"] == auth_user["user_id"]
    assert payload["plan"] == "free"
    assert payload["usage"]["requests_today"] == 1
    assert payload["usage"]["limit"] == FREE_DAILY_LIMIT
    assert payload["usage"]["remaining"] == FREE_DAILY_LIMIT - 1
    assert payload["usage"]["total_tokens"] == 11

    logs_response = await test_client.get("/logs")
    logs = logs_response.json()
    assert logs[0]["user_id"] == auth_user["user_id"]
    assert logs[0]["request_count"] == 1


@pytest.mark.asyncio
async def test_chat_blocks_requests_after_daily_free_limit(test_client: httpx.AsyncClient):
    auth_user = await signup_user(test_client, email="free-tier@example.com")

    for _ in range(FREE_DAILY_LIMIT):
        response = await test_client.post(
            "/chat",
            json={
                "message": "limit test",
                "session_id": "usage-session-2",
            },
        )
        assert response.status_code == 200

    blocked_response = await test_client.post(
        "/chat",
        json={
            "message": "limit test",
            "session_id": "usage-session-2",
        },
    )

    assert blocked_response.status_code == 429
    assert blocked_response.json() == {
        "user_id": auth_user["user_id"],
        "plan": "free",
        "error": "limit_reached",
        "message": "Daily free limit reached. Upgrade required.",
        "limit": FREE_DAILY_LIMIT,
    }

    logs_response = await test_client.get("/logs")
    logs = logs_response.json()
    assert logs[0]["user_id"] == auth_user["user_id"]
    assert logs[0]["request_count"] == FREE_DAILY_LIMIT
    assert logs[0]["status_code"] == 429


@pytest.mark.asyncio
async def test_pro_users_bypass_free_daily_limit(test_client: httpx.AsyncClient):
    auth_user = await signup_user(test_client, email="pro@example.com")
    webhook_body = json.dumps(
        {
            "type": "checkout.session.completed",
            "data": {"object": {"metadata": {"user_id": auth_user["user_id"]}}},
        }
    ).encode("utf-8")
    await test_client.post(
        "/webhook",
        content=webhook_body,
        headers={"Stripe-Signature": build_stripe_signature(webhook_body)},
    )

    for _ in range(FREE_DAILY_LIMIT + 3):
        response = await test_client.post(
            "/chat",
            json={
                "message": "pro test",
                "session_id": "usage-session-pro",
            },
        )
        assert response.status_code == 200
        payload = response.json()
        assert payload["plan"] == "pro"
        assert payload["usage"]["plan"] == "pro"
        assert payload["usage"]["remaining"] is None


@pytest.mark.asyncio
async def test_create_checkout_session_returns_checkout_url(test_client: httpx.AsyncClient, monkeypatch: pytest.MonkeyPatch):
    auth_user = await signup_user(test_client, email="checkout@example.com")

    async def fake_create_checkout_session(*, user_id: str, email: str | None = None):
        assert user_id == auth_user["user_id"]
        assert email == auth_user["email"]
        return {"id": "cs_test_123", "url": "https://checkout.stripe.com/pay/cs_test_123"}

    monkeypatch.setattr(main_module, "create_checkout_session", fake_create_checkout_session)

    response = await test_client.post("/create-checkout-session", json={})

    assert response.status_code == 200
    assert response.json() == {
        "user_id": auth_user["user_id"],
        "url": "https://checkout.stripe.com/pay/cs_test_123",
        "checkout_session_id": "cs_test_123",
    }


@pytest.mark.asyncio
async def test_webhook_upgrades_user_to_pro(test_client: httpx.AsyncClient):
    auth_user = await signup_user(test_client, email="paid@example.com")
    payload = {
        "type": "checkout.session.completed",
        "data": {
            "object": {
                "id": "cs_test_123",
                "metadata": {
                    "user_id": auth_user["user_id"],
                },
            }
        },
    }
    body = json.dumps(payload).encode("utf-8")

    response = await test_client.post(
        "/webhook",
        content=body,
        headers={"Stripe-Signature": build_stripe_signature(body)},
    )

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "user_id": auth_user["user_id"], "plan": "pro"}

    chat_response = await test_client.get("/auth/me")
    assert chat_response.status_code == 200
    assert chat_response.json()["plan"] == "pro"

    user_response = await test_client.get(f"/user/{auth_user['user_id']}")
    assert user_response.status_code == 200
    assert user_response.json()["plan"] == "pro"


@pytest.mark.asyncio
async def test_auth_login_logout_and_me(test_client: httpx.AsyncClient):
    signup_payload = await signup_user(test_client, email="auth@example.com", name="Auth User")
    assert signup_payload["email"] == "auth@example.com"

    me_response = await test_client.get("/auth/me")
    assert me_response.status_code == 200
    assert me_response.json()["email"] == "auth@example.com"

    logout_response = await test_client.post("/auth/logout")
    assert logout_response.status_code == 200

    me_after_logout = await test_client.get("/auth/me")
    assert me_after_logout.status_code == 401

    login_response = await test_client.post(
        "/auth/login",
        json={"email": "auth@example.com", "password": "password123"},
    )
    assert login_response.status_code == 200
    assert login_response.json()["email"] == "auth@example.com"


@pytest.mark.asyncio
async def test_oauth_start_redirects_to_provider(test_client: httpx.AsyncClient):
    google_response = await test_client.get("/auth/oauth/google/start", follow_redirects=False)
    assert google_response.status_code == 302
    assert "accounts.google.com" in google_response.headers["location"]

    github_response = await test_client.get("/auth/oauth/github/start", follow_redirects=False)
    assert github_response.status_code == 302
    assert "github.com/login/oauth/authorize" in github_response.headers["location"]
