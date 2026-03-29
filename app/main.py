from __future__ import annotations

import asyncio
import os
import secrets
import uuid
from contextlib import asynccontextmanager
from urllib.parse import urlparse

import json as json_mod

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException, Query, Request, Response
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import RedirectResponse

from .auth import hash_password, jwt_manager, verify_password
from .db import db
from .models import (
    AddMessageRequest,
    AuthTokenResponse,
    ChatModelOption,
    ChatRequest,
    CreateSessionRequest,
    LogEntry,
    LoginRequest,
    SessionChatRequest,
    SessionMessageResponse,
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
from .backtest import backtest_scheduler, get_backtest_status, restore_run_state_from_db, run_backtest
from .router import invalidate_score_cache
from .settings import settings_store

load_dotenv()


@asynccontextmanager
async def lifespan(app: FastAPI):
    await db.init()
    timeout = httpx.Timeout(connect=30.0, read=300.0, write=300.0, pool=300.0)
    async with httpx.AsyncClient(timeout=timeout) as client:
        app.state.http_client = client
        # Restore last backtest run state from DB so dashboard isn't blank after restart
        restore_run_state_from_db()
        # Auto-refresh models from all providers on startup
        try:
            await model_registry.refresh(client)
        except Exception:
            pass  # non-fatal — will retry via scheduler
        # Launch backtest scheduler in background
        scheduler_task = asyncio.create_task(backtest_scheduler(client))
        try:
            yield
        finally:
            scheduler_task.cancel()


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
# Maps state token -> {"redirect_to": "https://..."} or empty dict
_oauth_states: dict[str, dict] = {}


def _generate_oauth_state(redirect_to: str | None = None) -> str:
    state = secrets.token_urlsafe(32)
    _oauth_states[state] = {"redirect_to": redirect_to} if redirect_to else {}
    return state


def _verify_oauth_state(state: str) -> bool:
    return state in _oauth_states


def _consume_oauth_state(state: str) -> dict:
    return _oauth_states.pop(state, {})


def _extract_token(request: Request) -> str | None:
    """Extract JWT from Authorization header or cookie."""
    auth = request.headers.get("authorization", "")
    if auth.startswith("Bearer "):
        return auth[7:]
    return request.cookies.get("clawhelm_token")


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
    from .providers import provider_registry
    from .performance import get_all_model_stats, NEUTRAL_STATS
    from .scoring import score_model, cold_start_score

    available = model_registry.get_available_models()

    # Batch-fetch live stats and benchmark latencies (2 queries total)
    all_stats = await asyncio.to_thread(get_all_model_stats)
    bench_latencies = await asyncio.to_thread(db.get_all_benchmark_latencies)

    # Collect non-auto models with their real scores
    model_entries: list[dict] = []

    # Free models — always shown
    for m in available:
        if m.get("is_free"):
            model_entries.append({**m, "group": "free"})

    # Paid models — show if any provider with an API key is enabled
    has_provider = any(provider_registry.is_enabled(name) for name in provider_registry.all_names())
    if has_provider:
        for m in available:
            if not m.get("is_free"):
                model_entries.append({**m, "group": "paid"})

    # Score each model using the same formula as the router
    FREE_BONUS = 0.03
    for entry in model_entries:
        mid = entry["model_id"]
        stats = all_stats.get(mid, dict(NEUTRAL_STATS))
        bench_lat = bench_latencies.get(mid)
        s = score_model(entry, stats, benchmark_latency=bench_lat)
        if entry.get("is_free"):
            s += FREE_BONUS
        entry["_score"] = s
        entry["_speed_score"] = (1.0 / max(bench_lat, 0.1) / 10.0) if bench_lat else (
            1.0 / max(float(stats.get("avg_latency") or 1.0), 0.1) / 10.0
            if stats.get("sample_count", 0) > 0 else 0.5
        )
        entry["_quality_score"] = float(stats.get("success_rate") or 0.5)
        cost = float(stats.get("avg_cost") or 0.0)
        entry["_cost_score"] = 1.0 if entry.get("is_free") else (0.5 if cost <= 0 else min(1.0 / (cost * 100 + 1), 1.0))

    # Assign ranks per dimension (1-indexed, higher score = lower rank number)
    for dim_key, field in (("overall", "_score"), ("speed", "_speed_score"), ("quality", "_quality_score"), ("cost", "_cost_score")):
        sorted_by_dim = sorted(model_entries, key=lambda e: e[field], reverse=True)
        for i, entry in enumerate(sorted_by_dim):
            rank_field = "rank" if dim_key == "overall" else f"rank_by_{dim_key}"
            entry[rank_field] = i + 1

    # Build response: Auto first, then models sorted by overall rank
    options: list[ChatModelOption] = [
        ChatModelOption(
            id="auto", label="Auto (Recommended)", model_id=None,
            is_free=False, recommended=True, group="auto",
            display_name="Auto — best model for your query",
        ),
    ]

    for m in sorted(model_entries, key=lambda e: e.get("rank", 999)):
        prompt_cost = float(m.get("prompt_cost", 0))
        completion_cost = float(m.get("completion_cost", 0))
        ctx = m.get("context_length")
        max_tok = m.get("max_completion_tokens")
        modality = m.get("modality", "text->text")

        # Build description from metadata (avoid duplicating badge/stat info)
        desc_parts: list[str] = []
        if max_tok:
            tok_k = f"{max_tok // 1000}k" if max_tok >= 1000 else str(max_tok)
            desc_parts.append(f"Up to {tok_k} output tokens")
        if modality and modality != "text->text":
            desc_parts.append(f"Supports {modality}")
        raw_display = m.get("display_name") or m["model_id"]
        display = raw_display.replace(" (free)", "").replace(":free", "")
        description = ". ".join(desc_parts) + ("." if desc_parts else "")

        options.append(ChatModelOption(
            id=m["model_id"],
            label=display,
            model_id=m["model_id"],
            is_free=m.get("is_free", False),
            group=m["group"],
            display_name=display,
            context_length=ctx,
            max_completion_tokens=max_tok,
            modality=modality,
            provider=m.get("provider", ""),
            rank=m.get("rank"),
            rank_by_speed=m.get("rank_by_speed"),
            rank_by_quality=m.get("rank_by_quality"),
            rank_by_cost=m.get("rank_by_cost"),
            prompt_cost_per_m=round(prompt_cost * 1_000_000, 4) if prompt_cost > 0 else None,
            completion_cost_per_m=round(completion_cost * 1_000_000, 4) if completion_cost > 0 else None,
            description=description,
        ))

    return options


@app.get("/logs", response_model=list[LogEntry])
async def get_logs():
    return await db.get_recent_logs(limit=50)


@app.get("/stats", response_model=StatsResponse)
async def get_stats():
    return await db.get_stats()




@app.get("/refresh-models")
async def refresh_models(request: Request):
    client: httpx.AsyncClient = request.app.state.http_client
    return await model_registry.refresh(client)


@app.delete("/admin/logs")
async def clear_logs_before(before: str = Query(..., description="ISO date e.g. 2026-03-29")):
    """Delete routing logs before the given date and invalidate score cache."""
    deleted = await asyncio.to_thread(db.delete_logs_before, before)
    invalidate_score_cache()
    return {"deleted": deleted, "before": before}


@app.delete("/admin/benchmarks/bad-models")
async def remove_non_chat_benchmark_data():
    """Remove benchmark data for known non-chat models (safety classifiers, etc.)."""
    bad_models = [
        "openai/gpt-oss-safeguard-20b",
        "openai/gpt-oss-120b",
        "openai/gpt-oss-20b",
        "meta-llama/llama-prompt-guard-2-22m",
        "meta-llama/llama-prompt-guard-2-86m",
    ]
    deleted = await asyncio.to_thread(db.delete_benchmark_results_for_models, bad_models)
    invalidate_score_cache()
    return {"deleted": deleted, "models": bad_models}


# Backtest endpoints
@app.post("/backtest/run")
async def start_backtest(request: Request):
    client: httpx.AsyncClient = request.app.state.http_client
    run_id = await run_backtest(client)
    status = get_backtest_status()
    return {"run_id": run_id, "status": status["status"]}


@app.get("/backtest/status")
async def backtest_status():
    return get_backtest_status()


@app.get("/backtest/results")
async def backtest_results():
    return db.get_benchmark_results_summary()


@app.get("/admin/dashboard")
async def admin_dashboard():
    """Admin dashboard: system health, recent logs, stats, scheduler status."""
    recent_logs = await asyncio.to_thread(db.get_recent_logs, 20)
    model_stats = await asyncio.to_thread(db.get_model_stats_summary)
    benchmark_results = await asyncio.to_thread(db.get_benchmark_results_summary)
    return {
        "health": {"status": "ok", "service": "clawhelm"},
        "backtest_status": get_backtest_status(),
        "recent_logs": recent_logs,
        "model_stats": model_stats,
        "benchmark_results": benchmark_results,
    }


# OAuth endpoints
@app.get("/auth/google/login")
async def google_login(redirect_to: str | None = Query(None)):
    oauth_client = create_oauth_client("google")
    if not oauth_client:
        raise HTTPException(status_code=400, detail="Google OAuth not configured")
    state = _generate_oauth_state(redirect_to)
    redirect_url = oauth_client.get_authorization_url(state)
    return RedirectResponse(url=redirect_url)


@app.get("/auth/google/callback")
@app.get("/auth/oauth/google/callback")
async def google_callback(code: str, state: str, response: Response):
    if not _verify_oauth_state(state):
        raise HTTPException(status_code=400, detail="Invalid state parameter")
    state_data = _consume_oauth_state(state)

    oauth_client = create_oauth_client("google")
    if not oauth_client:
        raise HTTPException(status_code=400, detail="Google OAuth not configured")

    # Use redirect_to from state if provided, else fall back to FRONTEND_BASE_URL
    frontend_url = (
        state_data.get("redirect_to")
        or os.getenv("FRONTEND_BASE_URL", "http://localhost:5173")
    ).rstrip("/")

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
        return RedirectResponse(url=f"{frontend_url}/?auth_token={access_token}")
    except Exception as e:
        return RedirectResponse(url=f"{frontend_url}/?auth_error={str(e)}")


@app.get("/auth/github/login")
async def github_login(redirect_to: str | None = Query(None)):
    oauth_client = create_oauth_client("github")
    if not oauth_client:
        raise HTTPException(status_code=400, detail="GitHub OAuth not configured")
    state = _generate_oauth_state(redirect_to)
    redirect_url = oauth_client.get_authorization_url(state)
    return RedirectResponse(url=redirect_url)


@app.get("/auth/github/callback")
@app.get("/auth/oauth/github/callback")
async def github_callback(code: str, state: str, response: Response):
    if not _verify_oauth_state(state):
        raise HTTPException(status_code=400, detail="Invalid state parameter")
    state_data = _consume_oauth_state(state)

    oauth_client = create_oauth_client("github")
    if not oauth_client:
        raise HTTPException(status_code=400, detail="GitHub OAuth not configured")

    # Use redirect_to from state if provided, else fall back to FRONTEND_BASE_URL
    frontend_url = (
        state_data.get("redirect_to")
        or os.getenv("FRONTEND_BASE_URL", "http://localhost:5173")
    ).rstrip("/")

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
        return RedirectResponse(url=f"{frontend_url}/?auth_token={access_token}")
    except Exception as e:
        return RedirectResponse(url=f"{frontend_url}/?auth_error={str(e)}")


# Auth endpoints
@app.get("/auth/me", response_model=UserResponse | None)
async def get_current_user_endpoint(request: Request):
    token = _extract_token(request)
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
async def list_sessions(request: Request):
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    payload = jwt_manager.verify_token(token)
    if not payload:
        raise HTTPException(status_code=401, detail="Invalid token")

    sessions = await db.get_user_sessions(payload["user_id"])
    return sessions


@app.post("/sessions", response_model=SessionResponse)
async def create_session(payload: CreateSessionRequest, request: Request):
    token = _extract_token(request)
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
async def get_session(session_id: str, request: Request):
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token_data = jwt_manager.verify_token(token)
    if not token_data:
        raise HTTPException(status_code=401, detail="Invalid token")

    messages = await db.get_session_messages(session_id)
    return {"session_id": session_id, "messages": messages}


@app.put("/sessions/{session_id}", response_model=SessionResponse)
async def update_session(session_id: str, payload: UpdateSessionRequest, request: Request):
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token_data = jwt_manager.verify_token(token)
    if not token_data:
        raise HTTPException(status_code=401, detail="Invalid token")

    session = await db.update_session_title(session_id, payload.title)
    return session


@app.post("/sessions/{session_id}/messages", response_model=SessionMessageResponse)
async def add_message(session_id: str, payload: AddMessageRequest, request: Request):
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token_data = jwt_manager.verify_token(token)
    if not token_data:
        raise HTTPException(status_code=401, detail="Invalid token")

    message = await db.add_session_message(
        session_id=session_id,
        role=payload.role,
        content=payload.content,
        meta=payload.meta,
    )
    return message


@app.delete("/sessions/{session_id}")
async def delete_session(session_id: str, request: Request):
    token = _extract_token(request)
    if not token:
        raise HTTPException(status_code=401, detail="Not authenticated")
    token_data = jwt_manager.verify_token(token)
    if not token_data:
        raise HTTPException(status_code=401, detail="Invalid token")

    await db.delete_session(session_id)
    return {"message": "Session deleted"}


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": "clawhelm",
        "allow_openrouter_routing": os.getenv("ALLOW_OPENROUTER_ROUTING", "true").lower() == "true",
    }
