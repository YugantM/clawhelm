from __future__ import annotations

import json
import time
from collections.abc import Mapping
from typing import Any

import httpx
from fastapi import HTTPException, Request, Response
from starlette.background import BackgroundTask
from starlette.datastructures import MutableHeaders
from starlette.responses import StreamingResponse

from ..cloud.memory import memory_store
from ..cloud.session import session_store
from ..cloud.style import apply_style_layer, default_style
from ..config.feature_flags import ENABLE_MEMORY, ENABLE_PREMIUM_ROUTING, ENABLE_STYLE_LAYER, is_cloud_mode
from ..costs import estimate_cost
from ..db import db
from .models_registry import model_registry
from .router import RouteDecision, encode_request_body, get_route_decisions as get_core_route_decisions, override_model
from ..cloud.premium_router import get_route_decisions as get_premium_route_decisions

TRUNCATE_LIMIT = 500
HOP_BY_HOP_HEADERS = {
    "connection",
    "keep-alive",
    "content-encoding",
    "proxy-authenticate",
    "proxy-authorization",
    "te",
    "trailer",
    "transfer-encoding",
    "upgrade",
    "content-length",
}


def truncate_text(value: str | None, limit: int = TRUNCATE_LIMIT) -> str | None:
    if value is None:
        return None
    return value[:limit]


def stringify_messages(messages: Any) -> str | None:
    if messages is None:
        return None
    try:
        return json.dumps(messages, ensure_ascii=True)
    except (TypeError, ValueError):
        return str(messages)


def extract_response_content(payload: Any) -> str | None:
    if not isinstance(payload, Mapping):
        return None
    choices = payload.get("choices")
    if not isinstance(choices, list) or not choices:
        return None
    first_choice = choices[0]
    if not isinstance(first_choice, Mapping):
        return None
    message = first_choice.get("message")
    if not isinstance(message, Mapping):
        return None
    content = message.get("content")
    if content is None:
        return None
    if isinstance(content, str):
        return content
    try:
        return json.dumps(content, ensure_ascii=True)
    except (TypeError, ValueError):
        return str(content)


def _coerce_token_int(*values: Any) -> int | None:
    for value in values:
        if isinstance(value, int):
            return value
        if isinstance(value, str) and value.isdigit():
            return int(value)
    return None


def extract_total_tokens(payload: Any) -> int | None:
    if not isinstance(payload, Mapping):
        return None
    usage = payload.get("usage")
    if not isinstance(usage, Mapping):
        return None

    for candidate in (usage.get("total_tokens"), usage.get("totalTokens")):
        if isinstance(candidate, int):
            return candidate

    prompt_tokens = _coerce_token_int(
        usage.get("prompt_tokens"),
        usage.get("promptTokens"),
        usage.get("input_tokens"),
        usage.get("inputTokens"),
    )
    completion_tokens = _coerce_token_int(
        usage.get("completion_tokens"),
        usage.get("completionTokens"),
        usage.get("output_tokens"),
        usage.get("outputTokens"),
    )
    if prompt_tokens is not None and completion_tokens is not None:
        return prompt_tokens + completion_tokens
    return None


def extract_actual_model(payload: Any) -> str | None:
    if not isinstance(payload, Mapping):
        return None
    model = payload.get("model")
    return model if isinstance(model, str) else None


def build_model_display_name(selected_model: str | None, actual_model: str | None) -> str | None:
    if not selected_model and not actual_model:
        return None
    if selected_model == "openrouter/free" and actual_model and actual_model != selected_model:
        return f"{selected_model} -> {actual_model}"
    return actual_model or selected_model


def filter_response_headers(headers: httpx.Headers) -> dict[str, str]:
    return {key: value for key, value in headers.items() if key.lower() not in HOP_BY_HOP_HEADERS}


def add_usage_headers(
    headers: MutableHeaders,
    user_id: str | None,
    usage_summary: Mapping[str, Any] | None,
    plan: str | None,
) -> None:
    if user_id:
        headers["X-User-Id"] = user_id
    if plan:
        headers["X-User-Plan"] = plan
    if not usage_summary:
        return
    headers["X-Usage-Requests-Today"] = str(usage_summary.get("requests_today", 0))
    headers["X-Usage-Limit"] = str(usage_summary.get("limit", 0))
    remaining = usage_summary.get("remaining")
    if remaining is None:
        headers["X-Usage-Remaining"] = "unlimited"
    else:
        headers["X-Usage-Remaining"] = str(remaining)


def add_usage_payload(payload: Any, user_id: str | None, usage_summary: Mapping[str, Any] | None, plan: str | None) -> Any:
    if not isinstance(payload, dict):
        return payload

    response_payload = dict(payload)
    if user_id:
        response_payload["user_id"] = user_id
    if plan:
        response_payload["plan"] = plan

    merged_usage: dict[str, Any] = {}
    existing_usage = response_payload.get("usage")
    if isinstance(existing_usage, Mapping):
        merged_usage.update(existing_usage)
    if usage_summary:
        merged_usage.update(usage_summary)
    if merged_usage:
        response_payload["usage"] = merged_usage

    return response_payload


def detect_request_source(request: Request, original_model: str | None) -> str:
    explicit_source = request.headers.get("x-clawhelm-client", "").strip().lower()
    if explicit_source in {"dashboard", "openclaw", "external"}:
        return explicit_source
    user_agent = request.headers.get("user-agent", "").lower()
    if "openclaw" in user_agent:
        return "openclaw"
    origin = request.headers.get("origin", "").lower()
    referer = request.headers.get("referer", "").lower()
    if ":5173" in origin or ":5173" in referer:
        return "dashboard"
    if original_model == "clawhelm-auto":
        return "openclaw"
    return "external"


def _pick_route_decisions(request_json: dict[str, Any] | None) -> list[RouteDecision]:
    if is_cloud_mode() and ENABLE_PREMIUM_ROUTING:
        return get_premium_route_decisions(registry=model_registry)
    return get_core_route_decisions(request_json, registry=model_registry)


async def _prepare_cloud_request(request_json: dict[str, Any], request: Request) -> tuple[dict[str, Any], str]:
    session_id = request.headers.get("x-session-id") or request_json.get("session_id")
    session = await session_store.ensure_session(session_id, style_profile=default_style, metadata={"source": "cloud"})
    resolved_session_id = session["session_id"]
    request_json["session_id"] = resolved_session_id

    recent_messages: list[dict[str, Any]] = []
    if ENABLE_MEMORY:
        recent_messages = await memory_store.get_recent_messages(resolved_session_id, limit=12)

    incoming_messages = request_json.get("messages", [])
    if isinstance(incoming_messages, list):
        merged_messages = [*recent_messages, *incoming_messages]
    else:
        merged_messages = recent_messages

    if ENABLE_STYLE_LAYER:
        merged_messages = apply_style_layer(merged_messages)

    request_json["messages"] = merged_messages
    return request_json, resolved_session_id


async def forward_chat_completion(request: Request, client: httpx.AsyncClient) -> Response:
    request_body = await request.body()
    request_json: dict[str, Any] | None = None
    original_model: str | None = None
    prompt: str | None = None
    ranked_decisions: list[RouteDecision] = []
    route_decision: RouteDecision | None = None
    session_id: str | None = None

    try:
        parsed_request = json.loads(request_body)
        if isinstance(parsed_request, dict):
            request_json = parsed_request
            if isinstance(request_json.get("message"), str) and not request_json.get("messages"):
                request_json["messages"] = [{"role": "user", "content": request_json["message"]}]
            request_json.setdefault("model", "clawhelm-auto")
            original_model = parsed_request.get("model")
            if is_cloud_mode():
                request_json, session_id = await _prepare_cloud_request(request_json, request)
            prompt = stringify_messages(request_json.get("messages"))
            ranked_decisions = _pick_route_decisions(request_json)
            route_decision = ranked_decisions[0] if ranked_decisions else None
            if route_decision is None:
                raise HTTPException(status_code=503, detail="No available models for routing")
            request_json = override_model(request_json, route_decision.model)
            request_body = encode_request_body(request_json)
    except json.JSONDecodeError:
        prompt = truncate_text(request_body.decode("utf-8", errors="replace"))

    request_source = detect_request_source(request, original_model)
    user_id = getattr(request.state, "user_id", None)
    request_count = getattr(request.state, "request_count", None)
    usage_summary = getattr(request.state, "usage_summary", None)
    plan = getattr(request.state, "plan", None)
    started_at = time.perf_counter()
    response_text_for_log: str | None = None
    total_tokens: int | None = None
    fallback_used = False
    actual_model_for_log: str | None = route_decision.model if route_decision else original_model

    async def log_request(
        *,
        response_text: str | None,
        latency: float,
        total_tokens_value: int | None,
        status_code: int | None,
        decision: RouteDecision | None,
        actual_model: str | None,
    ) -> None:
        selected_model = decision.model if decision else original_model
        await db.insert_log(
            user_id=user_id,
            request_count=request_count,
            session_id=session_id,
            request_source=request_source,
            original_model=original_model,
            selected_model=selected_model,
            actual_model=actual_model or selected_model,
            model_display_name=build_model_display_name(selected_model, actual_model or selected_model),
            provider=decision.provider if decision else None,
            is_free_model=decision.is_free_model if decision else False,
            model_source=decision.model_source if decision else None,
            routing_reason=decision.routing_reason if decision else None,
            routing_score=decision.score if decision else None,
            status_code=status_code,
            fallback_used=fallback_used,
            prompt=truncate_text(prompt),
            response=truncate_text(response_text),
            latency=latency,
            total_tokens=total_tokens_value,
            estimated_cost=estimate_cost(actual_model or selected_model, total_tokens_value),
        )

    async def send_request(effective_body: bytes, decision: RouteDecision, *, stream: bool) -> httpx.Response:
        if not decision.api_key:
            raise HTTPException(status_code=500, detail=f"{decision.provider.upper()} API key is not configured")

        outbound_headers = {
            "authorization": f"Bearer {decision.api_key}",
            "content-type": request.headers.get("content-type", "application/json"),
        }
        if accept := request.headers.get("accept"):
            outbound_headers["accept"] = accept

        if stream:
            upstream_request = client.build_request(
                "POST",
                f"{decision.base_url}{decision.chat_path}",
                content=effective_body,
                headers=outbound_headers,
            )
            return await client.send(upstream_request, stream=True)
        return await client.post(f"{decision.base_url}{decision.chat_path}", content=effective_body, headers=outbound_headers)

    try:
        is_streaming = bool(request_json and request_json.get("stream") is True)
        active_decision = ranked_decisions[0] if ranked_decisions else route_decision
        provider_response = await send_request(request_body, active_decision, stream=is_streaming) if active_decision else None

        decision_index = 0
        while provider_response is not None and provider_response.status_code >= 400 and request_json:
            decision_index += 1
            if decision_index >= len(ranked_decisions):
                break
            fallback_decision = ranked_decisions[decision_index]
            if is_streaming:
                await provider_response.aclose()
            request_json = override_model(request_json, fallback_decision.model)
            request_body = encode_request_body(request_json)
            active_decision = fallback_decision
            fallback_used = True
            actual_model_for_log = active_decision.model
            active_decision.routing_reason = "fallback escalation"
            provider_response = await send_request(request_body, active_decision, stream=is_streaming)

        latency = time.perf_counter() - started_at

        if is_streaming:
            log_buffer = bytearray()

            async def stream_and_capture():
                try:
                    async for chunk in provider_response.aiter_bytes():
                        if len(log_buffer) < TRUNCATE_LIMIT:
                            remaining = TRUNCATE_LIMIT - len(log_buffer)
                            log_buffer.extend(chunk[:remaining])
                        yield chunk
                finally:
                    await provider_response.aclose()

            async def finalize_stream_log() -> None:
                response_preview = log_buffer.decode("utf-8", errors="replace") or None
                await log_request(
                    response_text=response_preview,
                    latency=latency,
                    total_tokens_value=None,
                    status_code=provider_response.status_code,
                    decision=active_decision,
                    actual_model=actual_model_for_log,
                )

            stream_response = StreamingResponse(
                stream_and_capture(),
                status_code=provider_response.status_code,
                headers=filter_response_headers(provider_response.headers),
                media_type=provider_response.headers.get("content-type"),
                background=BackgroundTask(finalize_stream_log),
            )
            if 200 <= provider_response.status_code < 400:
                add_usage_headers(stream_response.headers, user_id, usage_summary, plan)
            return stream_response

        response_payload: Any = None
        try:
            response_payload = provider_response.json()
        except json.JSONDecodeError:
            response_text_for_log = provider_response.text
        else:
            response_text_for_log = extract_response_content(response_payload)
            total_tokens = extract_total_tokens(response_payload)
            actual_model_for_log = extract_actual_model(response_payload) or (active_decision.model if active_decision else original_model)

        if response_text_for_log is None:
            response_text_for_log = provider_response.text

        await log_request(
            response_text=response_text_for_log,
            latency=latency,
            total_tokens_value=total_tokens,
            status_code=provider_response.status_code if provider_response else None,
            decision=active_decision,
            actual_model=actual_model_for_log,
        )

        if is_cloud_mode() and session_id and ENABLE_MEMORY and request_json:
            incoming_messages = request_json.get("messages", [])
            if isinstance(incoming_messages, list):
                await memory_store.store_messages(session_id, incoming_messages)
            if response_text_for_log:
                await memory_store.store_messages(session_id, [{"role": "assistant", "content": response_text_for_log}])

        response_headers = filter_response_headers(provider_response.headers)
        if 200 <= provider_response.status_code < 400:
            enriched_payload = add_usage_payload(response_payload, user_id, usage_summary, plan)
            if enriched_payload is not response_payload:
                response_headers["content-type"] = "application/json"
                response = Response(
                    content=json.dumps(enriched_payload, ensure_ascii=True).encode("utf-8"),
                    status_code=provider_response.status_code,
                    headers=response_headers,
                    media_type="application/json",
                )
                add_usage_headers(response.headers, user_id, usage_summary, plan)
                return response

        response = Response(
            content=provider_response.content,
            status_code=provider_response.status_code,
            headers=response_headers,
            media_type=provider_response.headers.get("content-type"),
        )
        if 200 <= provider_response.status_code < 400:
            add_usage_headers(response.headers, user_id, usage_summary, plan)
        return response
    except HTTPException as exc:
        latency = time.perf_counter() - started_at
        await log_request(
            response_text=json.dumps({"detail": exc.detail}, ensure_ascii=True),
            latency=latency,
            total_tokens_value=total_tokens,
            status_code=exc.status_code,
            decision=route_decision,
            actual_model=actual_model_for_log,
        )
        raise
    except httpx.HTTPError as exc:
        latency = time.perf_counter() - started_at
        await log_request(
            response_text=str(exc),
            latency=latency,
            total_tokens_value=total_tokens,
            status_code=502,
            decision=route_decision,
            actual_model=actual_model_for_log,
        )
        raise HTTPException(status_code=502, detail="Provider request failed") from exc
