from __future__ import annotations

from fastapi import FastAPI, Header, HTTPException

app = FastAPI(title="clawhelm-mock-provider")


@app.get("/api/v1/models")
async def list_openrouter_models(authorization: str | None = Header(default=None)):
    if authorization != "Bearer local-openrouter-key":
        raise HTTPException(status_code=401, detail={"error": {"message": "Invalid OpenRouter API key"}})

    return {
        "data": [
            {"id": "openrouter/auto"},
            {"id": "meta-llama/llama-3.3-8b-instruct:free"},
            {"id": "google/gemma-2-9b-it:free"},
        ]
    }


async def _chat_completions(payload: dict, authorization: str | None = Header(default=None)):
    valid_keys = {"Bearer local-test-key", "Bearer local-openrouter-key"}
    if authorization not in valid_keys:
        raise HTTPException(
            status_code=401,
            detail={
                "error": {
                    "message": "Invalid API key",
                    "type": "invalid_request_error",
                    "code": "invalid_api_key",
                }
            },
        )

    if payload.get("model") == "gpt-3.5-turbo-fail":
        raise HTTPException(
            status_code=429,
            detail={
                "error": {
                    "message": "Cheap tier unavailable",
                    "type": "rate_limit_error",
                    "code": "cheap_model_unavailable",
                }
            },
        )

    if payload.get("model") == "force-error":
        raise HTTPException(
            status_code=429,
            detail={
                "error": {
                    "message": "Rate limit hit",
                    "type": "rate_limit_error",
                    "code": "rate_limit_exceeded",
                }
            },
        )

    user_content = ""
    for message in payload.get("messages", []):
        if message.get("role") == "user":
            user_content = message.get("content", "")
            break

    if "force-error" in user_content:
        raise HTTPException(
            status_code=429,
            detail={
                "error": {
                    "message": "Rate limit hit",
                    "type": "rate_limit_error",
                    "code": "rate_limit_exceeded",
                }
            },
        )

    if payload.get("model") == "openrouter/free" and "free-fail" in user_content:
        raise HTTPException(
            status_code=429,
            detail={
                "error": {
                    "message": "Free tier unavailable",
                    "type": "rate_limit_error",
                    "code": "free_tier_unavailable",
                }
            },
        )

    if payload.get("model") == "openrouter/free":
        return {
            "id": "chatcmpl-mock-free",
            "object": "chat.completion",
            "created": 1710000001,
            "model": "meta-llama/llama-3.3-8b-instruct:free",
            "choices": [
                {
                    "index": 0,
                    "message": {
                        "role": "assistant",
                        "content": f"free:{user_content}",
                    },
                    "finish_reason": "stop",
                }
            ],
            "usage": {
                "prompt_tokens": 8,
                "completion_tokens": 3,
                "total_tokens": 11,
            },
        }

    return {
        "id": "chatcmpl-mock-123",
        "object": "chat.completion",
        "created": 1710000000,
        "model": payload.get("model", "mock-model"),
        "choices": [
            {
                "index": 0,
                "message": {
                    "role": "assistant",
                    "content": f"mock:{user_content}",
                },
                "finish_reason": "stop",
            }
        ],
        "usage": {
            "prompt_tokens": 10,
            "completion_tokens": 4,
            "total_tokens": 14,
        },
    }


@app.post("/v1/chat/completions")
async def openai_chat_completions(payload: dict, authorization: str | None = Header(default=None)):
    return await _chat_completions(payload, authorization)


@app.post("/api/v1/chat/completions")
async def openrouter_chat_completions_legacy(payload: dict, authorization: str | None = Header(default=None)):
    return await _chat_completions(payload, authorization)


@app.post("/chat/completions")
async def openrouter_chat_completions(payload: dict, authorization: str | None = Header(default=None)):
    return await _chat_completions(payload, authorization)
