from __future__ import annotations

import os
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .db import db
from .models import LogEntry, ProviderApiKeyUpdate, ProviderConfigResponse, StatsResponse
from .models_registry import model_registry
from .proxy import forward_chat_completion
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

frontend_origins = [
    origin.strip()
    for origin in os.getenv("FRONTEND_ORIGINS", "http://localhost:5173,http://127.0.0.1:5173").split(",")
    if origin.strip()
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=frontend_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.post("/v1/chat/completions")
async def chat_completions(request: Request):
    client: httpx.AsyncClient = request.app.state.http_client
    return await forward_chat_completion(request, client)


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
