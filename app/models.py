from __future__ import annotations

from datetime import datetime
from typing import Any

from pydantic import BaseModel


class LogEntry(BaseModel):
    id: int
    timestamp: datetime
    request_source: str | None
    original_model: str | None
    selected_model: str | None
    actual_model: str | None
    model_display_name: str | None
    provider: str | None
    is_free_model: bool
    model_source: str | None
    routing_reason: str | None
    routing_score: float | None
    status_code: int | None
    fallback_used: bool
    prompt: str | None
    response: str | None
    latency: float
    total_tokens: int | None
    estimated_cost: float


class StatsResponse(BaseModel):
    total_requests: int
    successful_requests: int
    failed_requests: int
    fallback_count: int
    avg_latency: float
    total_estimated_cost_usd: float
    free_model_usage_count: int
    requests_using_free_models: int
    cost_saved_estimate: float
    requests_by_actual_model: dict[str, int]
    requests_by_provider: dict[str, int]
    usage_by_provider: dict[str, int]
    performance_by_model: dict[str, dict[str, float]]
    candidate_scores: list[dict[str, Any]]


class ProviderStatus(BaseModel):
    configured: bool
    source: str
    masked_key: str | None


class ProviderConfigResponse(BaseModel):
    settings_path: str
    providers: dict[str, ProviderStatus]


class ProviderApiKeyUpdate(BaseModel):
    api_key: str = ""


class ChatRequest(BaseModel):
    model: str | None = None
    message: str | None = None
    messages: list[dict[str, Any]] | None = None


class ChatModelOption(BaseModel):
    id: str
    label: str
    model_id: str | None = None
    is_free: bool
    recommended: bool = False


class UserResponse(BaseModel):
    id: int
    email: str
    name: str | None
    provider: str
    avatar_url: str | None
    created_at: str


class SessionMessageResponse(BaseModel):
    id: int
    role: str
    content: str
    meta: dict[str, Any] | None
    created_at: str


class SessionResponse(BaseModel):
    id: str
    title: str | None
    created_at: str
    last_accessed_at: str
    message_count: int | None = None


class AuthTokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserResponse


class SessionChatRequest(BaseModel):
    messages: list[dict[str, Any]]
    session_id: str | None = None


class CreateSessionRequest(BaseModel):
    title: str | None = None


class UpdateSessionRequest(BaseModel):
    title: str


class SignupRequest(BaseModel):
    email: str
    password: str
    name: str | None = None


class LoginRequest(BaseModel):
    email: str
    password: str
