from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from typing import Any
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException

STRIPE_API_BASE_URL = "https://api.stripe.com/v1"
STRIPE_SIGNATURE_TOLERANCE_SECONDS = 300


def _get_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise HTTPException(status_code=503, detail=f"{name} is not configured")
    return value


def _default_checkout_url(path: str) -> str:
    base_url = os.getenv("FRONTEND_BASE_URL", "http://localhost:5173").rstrip("/")
    return f"{base_url}{path}"


async def create_checkout_session(*, user_id: str, email: str | None = None) -> dict[str, Any]:
    secret_key = _get_env("STRIPE_SECRET_KEY")
    price_id = _get_env("STRIPE_PRICE_ID")
    success_url = os.getenv("STRIPE_SUCCESS_URL", _default_checkout_url("/?checkout=success#Settings"))
    cancel_url = os.getenv("STRIPE_CANCEL_URL", _default_checkout_url("/?checkout=cancel#Settings"))

    form_body = urlencode(
        [
            ("mode", "payment"),
            ("success_url", success_url),
            ("cancel_url", cancel_url),
            ("line_items[0][price]", price_id),
            ("line_items[0][quantity]", "1"),
            ("metadata[user_id]", user_id),
            ("client_reference_id", user_id),
            *([("customer_email", email)] if email else []),
        ]
    )

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"{STRIPE_API_BASE_URL}/checkout/sessions",
            content=form_body,
            headers={
                "Authorization": f"Bearer {secret_key}",
                "Content-Type": "application/x-www-form-urlencoded",
            },
        )

    if response.status_code >= 400:
        detail: Any
        try:
            detail = response.json()
        except ValueError:
            detail = response.text or "Stripe request failed"
        raise HTTPException(status_code=502, detail=detail)

    payload = response.json()
    checkout_url = payload.get("url")
    if not isinstance(checkout_url, str) or not checkout_url:
        raise HTTPException(status_code=502, detail="Stripe checkout URL missing from response")
    return payload


def verify_webhook_and_parse_event(payload: bytes, signature_header: str | None) -> dict[str, Any]:
    webhook_secret = _get_env("STRIPE_WEBHOOK_SECRET")
    if not signature_header:
        raise HTTPException(status_code=400, detail="Missing Stripe-Signature header")

    parts: dict[str, list[str]] = {}
    for part in signature_header.split(","):
        key, _, value = part.partition("=")
        if not key or not value:
            continue
        parts.setdefault(key, []).append(value)

    timestamp_value = (parts.get("t") or [None])[0]
    signatures = parts.get("v1") or []
    if timestamp_value is None or not signatures:
        raise HTTPException(status_code=400, detail="Invalid Stripe-Signature header")

    try:
        timestamp = int(timestamp_value)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid Stripe signature timestamp") from exc

    if abs(int(time.time()) - timestamp) > STRIPE_SIGNATURE_TOLERANCE_SECONDS:
        raise HTTPException(status_code=400, detail="Stripe webhook timestamp outside tolerance")

    signed_payload = f"{timestamp}.{payload.decode('utf-8')}".encode("utf-8")
    expected_signature = hmac.new(
        webhook_secret.encode("utf-8"),
        signed_payload,
        hashlib.sha256,
    ).hexdigest()

    if not any(hmac.compare_digest(expected_signature, signature) for signature in signatures):
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook signature")

    try:
        event = json.loads(payload.decode("utf-8"))
    except json.JSONDecodeError as exc:
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook payload") from exc

    if not isinstance(event, dict):
        raise HTTPException(status_code=400, detail="Invalid Stripe webhook event")
    return event
