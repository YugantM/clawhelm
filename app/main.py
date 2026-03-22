from __future__ import annotations

import os
from contextlib import asynccontextmanager

import httpx
from dotenv import load_dotenv
from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware

from .db import db
from .models import LogEntry, StatsResponse
from .models_registry import model_registry
from .proxy import forward_chat_completion


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


@app.get("/refresh-models")
async def refresh_models(request: Request):
    client: httpx.AsyncClient = request.app.state.http_client
    return await model_registry.refresh(client)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "provider_base_url": os.getenv("PROVIDER_BASE_URL", "https://api.openai.com"),
        "openrouter_enabled": os.getenv("ENABLE_OPENROUTER", "false").lower() == "true",
    }
