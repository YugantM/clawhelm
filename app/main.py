from __future__ import annotations

import os
from contextlib import asynccontextmanager
from datetime import timedelta
from secrets import token_urlsafe
from urllib.parse import quote, urlparse
from uuid import uuid4

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, RedirectResponse

from .auth import (
    AUTH_COOKIE_NAME,
    SESSION_TTL_DAYS,
    build_password_hash,
    cookie_samesite,
    generate_session_token,
    get_session_expiry,
    hash_session_token,
    is_secure_cookie,
    isoformat,
    utcnow,
    verify_password,
)
from .cloud.billing import create_checkout_session, verify_webhook_and_parse_event
from .cloud.memory import memory_store
from .config.feature_flags import (
    ENABLE_CLOUD_MODE,
    ENABLE_MEMORY,
    ENABLE_PREMIUM_ROUTING,
    ENABLE_STYLE_LAYER,
    ENV_MODE,
    is_cloud_mode,
)
from .db import db
from .models import (
    AuthFormRequest,
    AuthUserResponse,
    ChatRequest,
    CheckoutSessionRequest,
    LogEntry,
    ProviderApiKeyUpdate,
    ProviderConfigResponse,
    SessionResponse,
    StatsResponse,
    UserAccountResponse,
)
from .models_registry import model_registry
from .oauth import build_github_auth_url, build_google_auth_url, fetch_github_identity, fetch_google_identity
from .proxy import detect_request_source, forward_chat_completion
from .settings import settings_store

load_dotenv()

FREE_DAILY_LIMIT = 20
OAUTH_STATE_TTL_MINUTES = 10


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init()
    timeout = httpx.Timeout(connect=30.0, read=300.0, write=300.0, pool=300.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        app.state.http_client = client
        yield


app = FastAPI(title="clawhelm", lifespan=lifespan)

frontend_origins = {
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
}

frontend_base_url = os.getenv("FRONTEND_BASE_URL", "").strip()
if frontend_base_url:
    parsed_frontend_url = urlparse(frontend_base_url)
    if parsed_frontend_url.scheme and parsed_frontend_url.netloc:
        frontend_origins.add(f"{parsed_frontend_url.scheme}://{parsed_frontend_url.netloc}")


app.add_middleware(
    CORSMiddleware,
    allow_origins=sorted(frontend_origins),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def serialize_user(user: dict[str, object]) -> dict[str, object]:
    requests_today = int(user.get("requests_today") or 0)
    plan = str(user.get("plan") or "free")
    is_superuser = bool(user.get("is_superuser"))
    remaining = None if plan == "pro" else max(FREE_DAILY_LIMIT - requests_today, 0)
    return {
        "user_id": str(user["id"]),
        "email": str(user["email"]),
        "name": str(user["name"]),
        "plan": plan,
        "is_superuser": is_superuser,
        "requests_today": requests_today,
        "limit": FREE_DAILY_LIMIT,
        "remaining": remaining,
        "last_updated": str(user["last_updated"])[:10],
    }


async def get_current_user(request: Request) -> dict[str, object] | None:
    session_token = request.cookies.get(AUTH_COOKIE_NAME)
    if not session_token:
        return None
    return await db.get_user_by_session_token_hash(hash_session_token(session_token))


async def require_current_user(request: Request) -> dict[str, object]:
    user = await get_current_user(request)
    if user is None:
        raise HTTPException(status_code=401, detail="Authentication required")
    return user


async def create_user_session_response(user: dict[str, object]) -> JSONResponse:
    session_token = generate_session_token()
    expires_at = get_session_expiry()
    await db.create_session(
        token_hash=hash_session_token(session_token),
        user_id=str(user["id"]),
        expires_at=isoformat(expires_at),
    )
    response = JSONResponse(serialize_user(user))
    response.set_cookie(
        key=AUTH_COOKIE_NAME,
        value=session_token,
        httponly=True,
        secure=is_secure_cookie(frontend_base_url),
        samesite=cookie_samesite(frontend_base_url),
        max_age=SESSION_TTL_DAYS * 24 * 60 * 60,
        expires=isoformat(expires_at),
        path="/",
    )
    return response


def build_frontend_redirect(path: str) -> str:
    base_url = frontend_base_url or "http://localhost:5173"
    return f"{base_url.rstrip('/')}{path}"


def build_backend_callback_url(request: Request, provider: str) -> str:
    if backend_base_url := os.getenv("BACKEND_BASE_URL", "").strip():
        return f"{backend_base_url.rstrip('/')}/auth/oauth/{provider}/callback"
    return str(request.url_for("oauth_callback", provider=provider))


@app.post("/auth/signup", response_model=AuthUserResponse)
async def signup(payload: AuthFormRequest):
    email = payload.email.strip().lower()
    password = payload.password
    name = (payload.name or "").strip() or email.split("@")[0]

    if not email or "@" not in email:
        raise HTTPException(status_code=400, detail="Valid email is required")
    if len(password) < 8:
        raise HTTPException(status_code=400, detail="Password must be at least 8 characters")
    if await db.get_user_by_email(email):
        raise HTTPException(status_code=409, detail="An account with that email already exists")

    user = await db.create_user(
        user_id=f"user_{uuid4().hex}",
        email=email,
        name=name,
        password_hash=build_password_hash(password),
        is_superuser=False,
    )
    return await create_user_session_response(user)


@app.post("/auth/login", response_model=AuthUserResponse)
async def login(payload: AuthFormRequest):
    email = payload.email.strip().lower()
    user = await db.get_user_by_email(email)
    if user is None or not verify_password(payload.password, user.get("password_hash")):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    return await create_user_session_response(user)


@app.post("/auth/logout")
async def logout(request: Request):
    session_token = request.cookies.get(AUTH_COOKIE_NAME)
    if session_token:
        await db.delete_session(hash_session_token(session_token))
    response = JSONResponse({"status": "ok"})
    response.delete_cookie(AUTH_COOKIE_NAME, path="/")
    return response


@app.get("/auth/me", response_model=AuthUserResponse)
async def auth_me(request: Request):
    user = await require_current_user(request)
    return serialize_user(user)


@app.get("/auth/oauth/{provider}/start")
async def oauth_start(provider: str, request: Request, redirect_path: str = "/?auth=success#Chat"):
    if provider not in {"google", "github"}:
        raise HTTPException(status_code=404, detail="Unknown OAuth provider")

    state = token_urlsafe(24)
    expires_at = isoformat(utcnow() + timedelta(minutes=OAUTH_STATE_TTL_MINUTES))
    await db.store_oauth_state(state=state, provider=provider, redirect_path=redirect_path, expires_at=expires_at)

    redirect_uri = build_backend_callback_url(request, provider)
    if provider == "google":
        auth_url = build_google_auth_url(state=state, redirect_uri=redirect_uri)
    else:
        auth_url = build_github_auth_url(state=state, redirect_uri=redirect_uri)

    return RedirectResponse(auth_url, status_code=302)


@app.get("/auth/oauth/{provider}/callback")
async def oauth_callback(provider: str, request: Request, state: str, code: str | None = None, error: str | None = None):
    if provider not in {"google", "github"}:
        raise HTTPException(status_code=404, detail="Unknown OAuth provider")

    oauth_state = await db.consume_oauth_state(state=state, provider=provider)
    if oauth_state is None:
        return RedirectResponse(build_frontend_redirect("/?auth=error#Chat"), status_code=302)
    if error or not code:
        return RedirectResponse(build_frontend_redirect("/?auth=error#Chat"), status_code=302)

    redirect_uri = build_backend_callback_url(request, provider)
    try:
        if provider == "google":
            identity = await fetch_google_identity(code=code, redirect_uri=redirect_uri)
        else:
            identity = await fetch_github_identity(code=code, redirect_uri=redirect_uri)
        user = await db.get_or_create_oauth_user(
            provider=provider,
            provider_user_id=identity["provider_user_id"],
            email=identity["email"],
            name=identity["name"],
        )
        response = await create_user_session_response(user)
        response.status_code = 302
        response.headers["Location"] = build_frontend_redirect(str(oauth_state.get("redirect_path") or "/?auth=success#Chat"))
        return response
    except (HTTPException, httpx.HTTPError):
        return RedirectResponse(build_frontend_redirect("/?auth=error#Chat"), status_code=302)


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    client: httpx.AsyncClient = request.app.state.http_client
    return await forward_chat_completion(request, client)


@app.post("/chat")
async def chat(request: Request, payload: ChatRequest):
    user = await require_current_user(request)
    allowed, updated_user = await db.consume_user_request(user_id=str(user["id"]), free_daily_limit=FREE_DAILY_LIMIT)
    if updated_user is None:
        raise HTTPException(status_code=401, detail="Authentication required")

    request.state.user_id = str(updated_user["id"])
    request.state.plan = str(updated_user["plan"])
    request.state.request_count = int(updated_user["requests_today"])
    request.state.usage_summary = {
        "requests_today": int(updated_user["requests_today"]),
        "limit": FREE_DAILY_LIMIT,
        "remaining": None if updated_user["plan"] == "pro" else max(FREE_DAILY_LIMIT - int(updated_user["requests_today"]), 0),
        "plan": str(updated_user["plan"]),
    }

    if not allowed:
        await db.insert_log(
            user_id=str(updated_user["id"]),
            request_count=int(updated_user["requests_today"]),
            session_id=payload.session_id,
            request_source=detect_request_source(request, payload.model),
            original_model=payload.model,
            selected_model=payload.model,
            actual_model=payload.model,
            model_display_name=payload.model,
            provider=None,
            is_free_model=False,
            model_source="usage_limit",
            routing_reason="daily free limit reached",
            routing_score=None,
            status_code=429,
            fallback_used=False,
            prompt=payload.message,
            response="Daily free limit reached. Upgrade required.",
            latency=0.0,
            total_tokens=None,
            estimated_cost=0.0,
        )
        error_payload = {
            "user_id": str(updated_user["id"]),
            "plan": str(updated_user["plan"]),
            "error": "limit_reached",
            "message": "Daily free limit reached. Upgrade required.",
            "limit": FREE_DAILY_LIMIT,
        }
        return JSONResponse(
            status_code=429,
            content=error_payload,
            headers={"X-User-Id": str(updated_user["id"]), "X-User-Plan": str(updated_user["plan"])},
        )

    client: httpx.AsyncClient = request.app.state.http_client
    return await forward_chat_completion(request, client)


@app.post("/create-checkout-session")
async def create_checkout(request: Request, payload: CheckoutSessionRequest | None = None):
    user = await require_current_user(request)
    checkout_payload = await create_checkout_session(user_id=str(user["id"]), email=str(user["email"]))
    return {
        "user_id": str(user["id"]),
        "url": checkout_payload.get("url"),
        "checkout_session_id": checkout_payload.get("id"),
    }


@app.get("/user/{user_id}", response_model=UserAccountResponse)
async def get_user(user_id: str, request: Request):
    current_user = await require_current_user(request)
    normalized_user_id = user_id.strip()
    if normalized_user_id != str(current_user["id"]):
        raise HTTPException(status_code=403, detail="Forbidden")
    return serialize_user(current_user)


@app.post("/webhook")
async def stripe_webhook(request: Request):
    payload = await request.body()
    signature = request.headers.get("stripe-signature")
    event = verify_webhook_and_parse_event(payload, signature)

    if event.get("type") == "checkout.session.completed":
        data_object = ((event.get("data") or {}).get("object") or {})
        if isinstance(data_object, dict):
            metadata = data_object.get("metadata") or {}
            if isinstance(metadata, dict):
                user_id = metadata.get("user_id")
                customer_id = data_object.get("customer")
                if isinstance(user_id, str) and user_id.strip():
                    user = await db.update_user_plan(
                        user_id=user_id.strip(),
                        plan="pro",
                        stripe_customer_id=customer_id if isinstance(customer_id, str) else None,
                    )
                    if user:
                        return {"status": "ok", "user_id": user_id.strip(), "plan": user["plan"]}

    return {"status": "ignored"}


@app.get("/logs", response_model=list[LogEntry])
async def get_logs():
    return await db.get_recent_logs(limit=50)


@app.get("/stats", response_model=StatsResponse)
async def get_stats():
    return await db.get_stats()


@app.get("/session/{session_id}", response_model=SessionResponse)
async def get_session(session_id: str):
    if not (is_cloud_mode() and ENABLE_CLOUD_MODE and ENABLE_MEMORY):
        raise HTTPException(status_code=404, detail="Session API is only available in cloud mode")
    session = await memory_store.get_session_payload(session_id)
    if session is None:
        raise HTTPException(status_code=404, detail="Session not found")
    return session


@app.get("/config/providers", response_model=ProviderConfigResponse)
async def get_provider_config():
    return await settings_store.get_provider_view()


@app.put("/config/providers/openrouter", response_model=ProviderConfigResponse)
async def update_openrouter_provider_config(payload: ProviderApiKeyUpdate, request: Request):
    result = await settings_store.set_provider_api_key("openrouter", payload.api_key)
    client: httpx.AsyncClient = request.app.state.http_client
    try:
        await model_registry.refresh(client)
    except httpx.HTTPError:
        pass
    return result


@app.get("/refresh-models")
async def refresh_models(request: Request):
    client: httpx.AsyncClient = request.app.state.http_client
    return await model_registry.refresh(client)


@app.get("/health")
async def health():
    provider_config = await settings_store.get_provider_view()
    return {
        "status": "ok",
        "service": "clawhelm",
        "env_mode": ENV_MODE,
        "cloud_mode": is_cloud_mode(),
        "enable_cloud_mode": ENABLE_CLOUD_MODE,
        "enable_memory": ENABLE_MEMORY,
        "enable_style_layer": ENABLE_STYLE_LAYER,
        "enable_premium_routing": ENABLE_PREMIUM_ROUTING,
        "provider_base_url": os.getenv("PROVIDER_BASE_URL", "https://api.openai.com"),
        "openrouter_enabled": os.getenv("ENABLE_OPENROUTER", "false").lower() == "true",
        "allow_openai_routing": os.getenv("ALLOW_OPENAI_ROUTING", "true").lower() == "true",
        "allow_openrouter_routing": os.getenv("ALLOW_OPENROUTER_ROUTING", "true").lower() == "true",
        "stripe_secret_key_configured": bool(os.getenv("STRIPE_SECRET_KEY", "").strip()),
        "stripe_price_id_configured": bool(os.getenv("STRIPE_PRICE_ID", "").strip()),
        "stripe_webhook_secret_configured": bool(os.getenv("STRIPE_WEBHOOK_SECRET", "").strip()),
        "google_oauth_configured": bool(os.getenv("GOOGLE_CLIENT_ID", "").strip() and os.getenv("GOOGLE_CLIENT_SECRET", "").strip()),
        "github_oauth_configured": bool(os.getenv("GITHUB_CLIENT_ID", "").strip() and os.getenv("GITHUB_CLIENT_SECRET", "").strip()),
        "frontend_base_url": os.getenv("FRONTEND_BASE_URL", "http://localhost:5173"),
        "db_path": str(db.db_path),
        "settings_path": provider_config["settings_path"],
        "openrouter_key_configured": provider_config["providers"]["openrouter"]["configured"],
    }
