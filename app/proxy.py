from __future__ import annotations

import json
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
from .router import (
    RouteDecision,
    encode_request_body,
    get_direct_route_decision,
    get_route_decisions,
    override_model,
    resolve_model_alias,
)

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

SYSTEM_IDENTITY_PROMPT = (
    "You are being accessed through ClawHelm. When asked who you are, always reply honestly: "
    "state your real model name and who made you, then explain that ClawHelm selected you "
    "as the best model for this query. "
    "For example: 'I am Llama 3.3, made by Meta. I was selected by ClawHelm to answer this prompt.' "
    "ClawHelm is an intelligent AI model router built by Harsiddhi Pari. "
    "It automatically picks the fastest, cheapest, and most capable model for every query "
    "from a pool of 350+ models across multiple providers. "
    "Do NOT claim to be a model you are not. Do NOT pretend to be ClawHelm itself."
)


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


def inject_identity_system_message(request_json: dict[str, Any]) -> dict[str, Any]:
    messages = request_json.get("messages")
    if not isinstance(messages, list):
        return request_json

    system_message = {"role": "system", "content": SYSTEM_IDENTITY_PROMPT}
    return {
        **request_json,
        "messages": [system_message, *messages],
    }


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


def _resolve_display_name(model_id: str | None) -> str | None:
    """Look up a clean display name from the registry, stripping ':free' and '(free)'."""
    if not model_id:
        return None
    info = model_registry.get_model(model_id)
    if info and info.display_name:
        return info.display_name.replace(" (free)", "").replace(":free", "")
    # Fallback: clean up the raw ID
    parts = model_id.split("/")
    slug = parts[-1] if len(parts) > 1 else model_id
    return slug.split(":")[0]


def _enrich_response(
    payload: Any,
    *,
    selected_model: str | None,
    actual_model: str | None,
    fallback_used: bool,
    fallback_from_model: str | None,
    routing_score: float | None = None,
    latency: float | None = None,
    provider: str | None = None,
) -> Any:
    if not isinstance(payload, dict):
        return payload
    enriched = dict(payload)
    if selected_model:
        enriched["selected_model"] = selected_model
    if actual_model:
        enriched["actual_model"] = actual_model
    enriched["display_name"] = _resolve_display_name(actual_model or selected_model)
    if provider:
        enriched["provider"] = provider
    if routing_score is not None:
        enriched["routing_score"] = round(routing_score, 4)
    if latency is not None:
        enriched["latency"] = round(latency, 3)
    if fallback_used:
        enriched["fallback_used"] = True
        if fallback_from_model:
            enriched["fallback_from_model"] = fallback_from_model
        if actual_model:
            enriched["fallback_to_model"] = actual_model
    return enriched


async def forward_chat_completion(request: Request, client: httpx.AsyncClient) -> Response:
    request_body = await request.body()
    request_json: dict[str, Any] | None = None
    original_model: str | None = None
    prompt: str | None = None
    ranked_decisions: list[RouteDecision] = []
    route_decision: RouteDecision | None = None

    try:
        parsed_request = json.loads(request_body)
        if isinstance(parsed_request, dict):
            request_json = parsed_request
            if isinstance(request_json.get("message"), str) and not request_json.get("messages"):
                request_json["messages"] = [{"role": "user", "content": request_json["message"]}]
            request_json.setdefault("model", "clawhelm-auto")
            original_model = parsed_request.get("model")
            request_json = inject_identity_system_message(request_json)
            prompt = stringify_messages(request_json.get("messages"))
            manual_model = resolve_model_alias(original_model)
            if manual_model is not None:
                route_decision = get_direct_route_decision(manual_model)
                ranked_decisions = [route_decision]
            else:
                ranked_decisions = get_route_decisions(request_json, registry=model_registry)
                route_decision = ranked_decisions[0] if ranked_decisions else None
            if route_decision is None:
                raise HTTPException(status_code=503, detail="No available models for routing")
            request_json = override_model(request_json, route_decision.model)
            request_body = encode_request_body(request_json)
    except json.JSONDecodeError:
        prompt = truncate_text(request_body.decode("utf-8", errors="replace"))

    request_source = detect_request_source(request, original_model)
    started_at = time.perf_counter()
    response_text_for_log: str | None = None
    total_tokens: int | None = None
    fallback_used = False
    fallback_from_model: str | None = None
    selected_model_for_log: str | None = route_decision.model if route_decision else original_model
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
        await db.insert_log(
            request_source=request_source,
            original_model=original_model,
            selected_model=selected_model_for_log,
            actual_model=actual_model or selected_model_for_log,
            model_display_name=build_model_display_name(selected_model_for_log, actual_model or selected_model_for_log),
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
            estimated_cost=estimate_cost(actual_model or selected_model_for_log, total_tokens_value),
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
        fallback_from_model = active_decision.model if active_decision else None
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
            active_decision.routing_reason = "fallback"
            provider_response = await send_request(request_body, active_decision, stream=is_streaming)

        latency = time.perf_counter() - started_at

        if is_streaming:
            log_buffer = bytearray()

            async def stream_and_capture():
                try:
                    async for chunk in provider_response.aiter_bytes():
                        if len(log_buffer) < TRUNCATE_LIMIT:
                            remaining_space = TRUNCATE_LIMIT - len(log_buffer)
                            log_buffer.extend(chunk[:remaining_space])
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

        response_headers = filter_response_headers(provider_response.headers)
        if 200 <= provider_response.status_code < 400 and isinstance(response_payload, dict):
            enriched = _enrich_response(
                response_payload,
                selected_model=original_model,
                actual_model=actual_model_for_log,
                fallback_used=fallback_used,
                fallback_from_model=fallback_from_model if fallback_used else None,
                routing_score=active_decision.score if active_decision else None,
                latency=latency,
                provider=active_decision.provider if active_decision else None,
            )
            response_headers["content-type"] = "application/json"
            return Response(
                content=json.dumps(enriched, ensure_ascii=True).encode("utf-8"),
                status_code=provider_response.status_code,
                headers=response_headers,
                media_type="application/json",
            )

        return Response(
            content=provider_response.content,
            status_code=provider_response.status_code,
            headers=response_headers,
            media_type=provider_response.headers.get("content-type"),
        )
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
