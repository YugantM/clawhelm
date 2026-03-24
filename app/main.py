from __future__ import annotations

import os
import secrets
import uuid
from contextlib import asynccontextmanager
from urllib.parse import urlparse

import httpx
from dotenv import load_dotenv
from fastapi import Cookie, FastAPI, HTTPException, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from .auth import hash_password, jwt_manager, verify_password
from .db import db
from .models import (
    AuthTokenResponse,
    ChatModelOption,
    ChatRequest,
    CreateSessionRequest,
    LogEntry,
    LoginRequest,
    ProviderApiKeyUpdate,
    ProviderConfigResponse,
    SessionChatRequest,
    SessionResponse,
    SignupRequest,
    StatsResponse,
    UpdateSessionRequest,
    UserResponse,
)
from .models_registry import model_registry
from .oauth import create_oauth_client
from .proxy import forward_chat_completion
from .router import is_valid_chat_model
from .settings import settings_store

load_dotenv()


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

# OAuth state tracking for CSRF protection
_oauth_states: dict[str, str] = {}


def _generate_oauth_state() -> str:
    state = secrets.token_urlsafe(32)
    _oauth_states[state] = state
    return state


def _verify_oauth_state(state: str) -> bool:
    return state in _oauth_states


def _consume_oauth_state(state: str) -> None:
    _oauth_states.pop(state, None)


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    client: httpx.AsyncClient = request.app.state.http_client
    return await forward_chat_completion(request, client)


@app.post("/chat")
async def chat(request: Request, payload: ChatRequest):
    if not is_valid_chat_model(payload.model):
        from fastapi import HTTPException
        raise HTTPException(status_code=400, detail="Unknown model")

    client: httpx.AsyncClient = request.app.state.http_client
    return await forward_chat_completion(request, client)


@app.get("/chat/models", response_model=list[ChatModelOption])
async def get_chat_models():
    free_openrouter_models = sorted(
        model["model_id"]
        for model in model_registry.get_available_models()
        if model.get("provider") == "openrouter" and model.get("is_free")
    )

    options = [
        ChatModelOption(id="auto", label="Auto", model_id=None, is_free=False, recommended=True),
    ]
    options.extend(
        ChatModelOption(
            id=model_id,
            label=model_id,
            model_id=model_id,
            is_free=True,
            recommended=False,
        )
        for model_id in free_openrouter_models
    )
    return options


@app.get("/logs", response_model=list[LogEntry])
async def get_logs():
    return await db.get_recent_logs(limit=50)


@app.get("/stats", response_model=StatsResponse)
async def get_stats():
    return await db.get_stats()


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


# OAuth endpoints
@app.get("/auth/google/login")
async def google_login():
    oauth_client = create_oauth_client("google")
    if not oauth_client:
        raise HTTPException(status_code=400, detail="Google OAuth not configured")
    state = _generate_oauth_state()
    redirect_url = oauth_client.get_authorization_url(state)
    return RedirectResponse(url=redirect_url)


@app.get("/auth/google/callback")
async def google_callback(code: str, state: str, response: Response):
    if not _verify_oauth_state(state):
        raise HTTPException(status_code=400, detail="Invalid state parameter")
    _consume_oauth_state(state)

    oauth_client = create_oauth_client("google")
    if not oauth_client:
        raise HTTPException(status_code=400, detail="Google OAuth not configured")

    frontend_url = os.getenv("FRONTEND_BASE_URL", "http://localhost:5173").rstrip("/")

    try:
        token_data = await oauth_client.exchange_code_for_token(code)
        user_info = await oauth_client.get_user_info(token_data["access_token"])

        user = await db.get_or_create_user(
            provider="google",
            provider_user_id=user_info["provider_user_id"],
            email=user_info["email"],
            name=user_info.get("name"),
            avatar_url=user_info.get("avatar_url"),
        )

        access_token = jwt_manager.create_token(user["id"])
        resp = RedirectResponse(url=f"{frontend_url}/?auth_success=true")
        resp.set_cookie(
            "clawhelm_token",
            access_token,
            max_age=30 * 24 * 3600,
            httponly=True,
            samesite="lax",
        )
        return resp
    except Exception as e:
        return RedirectResponse(url=f"{frontend_url}/?auth_error={str(e)}")


@app.get("/auth/github/login")
async def github_login():
    oauth_client = create_oauth_client("github")
    if not oauth_client:
        raise HTTPException(status_code=400, detail="GitHub OAuth not configured")
    state = _generate_oauth_state()
    redirect_url = oauth_client.get_authorization_url(state)
    return RedirectResponse(url=redirect_url)


@app.get("/auth/github/callback")
async def github_callback(code: str, state: str, response: Response):
    if not _verify_oauth_state(state):
        raise HTTPException(status_code=400, detail="Invalid state parameter")
    _consume_oauth_state(state)

    oauth_client = create_oauth_client("github")
    if not oauth_client:
        raise HTTPException(status_code=400, detail="GitHub OAuth not configured")

    frontend_url = os.getenv("FRONTEND_BASE_URL", "http://localhost:5173").rstrip("/")

    try:
        token_data = await oauth_client.exchange_code_for_token(code)
        user_info = await oauth_client.get_user_info(token_data["access_token"])

        user = await db.get_or_create_user(
            provider="github",
            provider_user_id=user_info["provider_user_id"],
            email=user_info["email"],
            name=user_info.get("name"),
            avatar_url=user_info.get("avatar_url"),
        )

        access_token = jwt_manager.create_token(user["id"])
        resp = RedirectResponse(url=f"{frontend_url}/?auth_success=true")
        resp.set_cookie(
            "clawhelm_token",
            access_token,
            max_age=30 * 24 * 3600,
            httponly=True,
            samesite="lax",
        )
        return resp
    except Exception as e:
        return RedirectResponse(url=f"{frontend_url}/?auth_error={str(e)}")


# Auth endpoints
@app.get("/auth/me", response_model=UserResponse | None)
async def get_current_user_endpoint(token: str | None = Cookie(None)):
    if not token:
        return None
    payload = jwt_manager.verify_token(token)
    if not payload:
        return None
    user = await db.get_user_by_id(payload["user_id"])
    if user:
        return UserResponse(
            id=user["id"],
            email=user["email"],
            name=user["name"],
            provider=user["provider"],
            avatar_url=user["avatar_url"],
            created_at=user["created_at"],
        )
    return None


@app.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie("clawhelm_token")
    return {"message": "Logged out"}


@app.get("/auth/providers")
async def get_auth_providers():
    return {
        "google": bool(create_oauth_client("google")),
        "github": bool(create_oauth_client("github")),
        "email": True,
    }


@app.post("/auth/signup")
async def signup(payload: SignupRequest, response: Response):
    existing = await db.get_user_by_email(payload.email)
    if existing:
        raise HTTPException(status_code=400, detail="Email already registered")
    hashed = hash_password(payload.password)
    user = await db.create_email_user(payload.email, hashed, payload.name)
    access_token = jwt_manager.create_token(user["id"])
    response.set_cookie("clawhelm_token", access_token, max_age=30 * 24 * 3600, httponly=True, samesite="lax")
    return {"access_token": access_token, "token_type": "bearer", "user": UserResponse(
        id=user["id"], email=user["email"], name=user["name"],
        provider=user["provider"], avatar_url=user["avatar_url"], created_at=user["created_at"],
    )}


@app.post("/auth/login")
async def login(payload: LoginRequest, response: Response):
    user = await db.get_user_by_email(payload.email)
    if not user or not user.get("password_hash"):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    if not verify_password(payload.password, user["password_hash"]):
        raise HTTPException(status_code=401, detail="Invalid email or password")
    access_token = jwt_manager.create_token(user["id"])
    response.set_cookie("clawhelm_token", access_token, max_age=30 * 24 * 3600, httponly=True, samesite="lax")
    return {"access_token": access_token, "token_type": "bearer", "user": UserResponse(
        id=user["id"], email=user["email"], name=user["name"],
        provider=user["provider"], avatar_url=user["avatar_url"], created_at=user["created_at"],
    )}


# Session endpoints
@app.get("/sessions", response_model=list[SessionResponse])
async def list_sessions(token: str | None = Cookie(None)):
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = jwt_manager.verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")

    sessions = await db.get_user_sessions(payload["user_id"])
    return sessions


@app.post("/sessions", response_model=SessionResponse)
async def create_session(payload: CreateSessionRequest, token: str | None = Cookie(None)):
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token_data = jwt_manager.verify_token(token)
    if not token_data:
        raise HTTPException(status_code=401, detail="Invalid token")

    session_id = str(uuid.uuid4())
    session = await db.create_session(
        user_id=token_data["user_id"],
        session_id=session_id,
        title=payload.title,
    )
    return session


@app.get("/sessions/{session_id}", response_model=dict)
async def get_session(session_id: str, token: str | None = Cookie(None)):
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token_data = jwt_manager.verify_token(token)
    if not token_data:
        raise HTTPException(status_code=401, detail="Invalid token")

    messages = await db.get_session_messages(session_id)
    return {"session_id": session_id, "messages": messages}


@app.put("/sessions/{session_id}", response_model=SessionResponse)
async def update_session(session_id: str, payload: UpdateSessionRequest, token: str | None = Cookie(None)):
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token_data = jwt_manager.verify_token(token)
    if not token_data:
        raise HTTPException(status_code=401, detail="Invalid token")

    session = await db.update_session_title(session_id, payload.title)
    return session


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str, token: str | None = Cookie(None)):
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token_data = jwt_manager.verify_token(token)
    if not token_data:
        raise HTTPException(status_code=401, detail="Invalid token")

    await db.delete_session(session_id)
    return {"message": "Session deleted"}


@app.get("/health")
async def health():
    provider_config = await settings_store.get_provider_view()
    return {
        "status": "ok",
        "service": "clawhelm",
        "provider_base_url": os.getenv("PROVIDER_BASE_URL", "https://api.openai.com"),
        "openrouter_enabled": os.getenv("ENABLE_OPENROUTER", "false").lower() == "true",
        "allow_openai_routing": os.getenv("ALLOW_OPENAI_ROUTING", "true").lower() == "true",
        "allow_openrouter_routing": os.getenv("ALLOW_OPENROUTER_ROUTING", "true").lower() == "true",
        "db_path": str(db.db_path),
        "settings_path": provider_config["settings_path"],
        "openrouter_key_configured": provider_config["providers"]["openrouter"]["configured"],
    }
