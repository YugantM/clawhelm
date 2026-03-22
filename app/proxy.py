from __future__ import annotations

import json
import os
import time
from collections.abc import Mapping
from typing import Any

import httpx
from fastapi import HTTPException, Request, Response
from starlette.background import BackgroundTask
from starlette.responses import StreamingResponse

from .costs import estimate_cost
from .db import db
from .models_registry import model_registry
from .router import RouteDecision, encode_request_body, get_ranked_route_decisions, override_model

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


def extract_total_tokens(payload: Any) -> int | None:
    if not isinstance(payload, Mapping):
        return None
    usage = payload.get("usage")
    if not isinstance(usage, Mapping):
        return None
    total_tokens = usage.get("total_tokens")
    return total_tokens if isinstance(total_tokens, int) else None


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
    return {
        key: value
        for key, value in headers.items()
        if key.lower() not in HOP_BY_HOP_HEADERS
    }


async def forward_chat_completion(request: Request, client: httpx.AsyncClient) -> Response:
    request_body = await request.body()
    request_json: dict[str, Any] | None = None
    original_model: str | None = None
    prompt: str | None = None
    ranked_decisions: list[RouteDecision] = []

    try:
        parsed_request = json.loads(request_body)
        if isinstance(parsed_request, dict):
            request_json = parsed_request
            original_model = parsed_request.get("model")
            prompt = stringify_messages(parsed_request.get("messages"))
            ranked_decisions = get_ranked_route_decisions(registry=model_registry)
            route_decision = ranked_decisions[0] if ranked_decisions else None
            if route_decision is None:
                raise HTTPException(status_code=503, detail="No available models for routing")
            request_json = override_model(parsed_request, route_decision.model)
            request_body = encode_request_body(request_json)
    except json.JSONDecodeError:
        prompt = truncate_text(request_body.decode("utf-8", errors="replace"))
        route_decision = None

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

    async def send_request(
        effective_body: bytes,
        decision: RouteDecision,
        *,
        stream: bool,
    ) -> httpx.Response:
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
        return await client.post(
            f"{decision.base_url}{decision.chat_path}",
            content=effective_body,
            headers=outbound_headers,
        )

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

            return StreamingResponse(
                stream_and_capture(),
                status_code=provider_response.status_code,
                headers=filter_response_headers(provider_response.headers),
                media_type=provider_response.headers.get("content-type"),
                background=BackgroundTask(finalize_stream_log),
            )

        response_payload: Any = None
        try:
            response_payload = provider_response.json()
        except json.JSONDecodeError:
            response_text_for_log = provider_response.text
        else:
            response_text_for_log = extract_response_content(response_payload)
            total_tokens = extract_total_tokens(response_payload)
            actual_model_for_log = extract_actual_model(response_payload) or (
                active_decision.model if active_decision else original_model
            )

        if response_text_for_log is None:
            response_text_for_log = provider_response.text

        await log_request(
            response_text=response_text_for_log,
            latency=latency,
            total_tokens_value=total_tokens,
            status_code=provider_response.status_code,
            decision=active_decision,
            actual_model=actual_model_for_log,
        )

        return Response(
            content=provider_response.content,
            status_code=provider_response.status_code,
            headers=filter_response_headers(provider_response.headers),
            media_type=provider_response.headers.get("content-type"),
        )
    except httpx.RequestError as exc:
        latency = time.perf_counter() - started_at
        response_text_for_log = str(exc)
        await log_request(
            response_text=response_text_for_log,
            latency=latency,
            total_tokens_value=None,
            status_code=502,
            decision=ranked_decisions[0] if ranked_decisions else None,
            actual_model=actual_model_for_log,
        )
        raise HTTPException(
            status_code=502,
            detail="Failed to reach upstream provider",
        ) from exc
