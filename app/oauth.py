from __future__ import annotations

import os
from urllib.parse import urlencode

import httpx
from fastapi import HTTPException


def _require_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise HTTPException(status_code=503, detail=f"{name} is not configured")
    return value


def build_google_auth_url(*, state: str, redirect_uri: str) -> str:
    query = urlencode(
        {
            "client_id": _require_env("GOOGLE_CLIENT_ID"),
            "redirect_uri": redirect_uri,
            "response_type": "code",
            "scope": "openid email profile",
            "state": state,
            "access_type": "offline",
            "prompt": "consent",
        }
    )
    return f"https://accounts.google.com/o/oauth2/v2/auth?{query}"


def build_github_auth_url(*, state: str, redirect_uri: str) -> str:
    query = urlencode(
        {
            "client_id": _require_env("GITHUB_CLIENT_ID"),
            "redirect_uri": redirect_uri,
            "scope": "read:user user:email",
            "state": state,
        }
    )
    return f"https://github.com/login/oauth/authorize?{query}"


async def fetch_google_identity(*, code: str, redirect_uri: str) -> dict[str, str]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        token_response = await client.post(
            "https://oauth2.googleapis.com/token",
            data={
                "client_id": _require_env("GOOGLE_CLIENT_ID"),
                "client_secret": _require_env("GOOGLE_CLIENT_SECRET"),
                "code": code,
                "grant_type": "authorization_code",
                "redirect_uri": redirect_uri,
            },
        )
        token_response.raise_for_status()
        token_payload = token_response.json()
        access_token = token_payload.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise HTTPException(status_code=502, detail="Google OAuth access token missing")

        userinfo_response = await client.get(
            "https://openidconnect.googleapis.com/v1/userinfo",
            headers={"Authorization": f"Bearer {access_token}"},
        )
        userinfo_response.raise_for_status()
        payload = userinfo_response.json()
    email = payload.get("email")
    subject = payload.get("sub")
    name = payload.get("name") or payload.get("given_name") or "Google User"
    if not isinstance(email, str) or not isinstance(subject, str):
        raise HTTPException(status_code=502, detail="Google account is missing email identity")
    return {"provider_user_id": subject, "email": email.lower(), "name": str(name)}


async def fetch_github_identity(*, code: str, redirect_uri: str) -> dict[str, str]:
    async with httpx.AsyncClient(timeout=30.0) as client:
        token_response = await client.post(
            "https://github.com/login/oauth/access_token",
            headers={"Accept": "application/json"},
            data={
                "client_id": _require_env("GITHUB_CLIENT_ID"),
                "client_secret": _require_env("GITHUB_CLIENT_SECRET"),
                "code": code,
                "redirect_uri": redirect_uri,
            },
        )
        token_response.raise_for_status()
        token_payload = token_response.json()
        access_token = token_payload.get("access_token")
        if not isinstance(access_token, str) or not access_token:
            raise HTTPException(status_code=502, detail="GitHub OAuth access token missing")

        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github+json",
        }
        user_response = await client.get("https://api.github.com/user", headers=headers)
        user_response.raise_for_status()
        user_payload = user_response.json()

        emails_response = await client.get("https://api.github.com/user/emails", headers=headers)
        emails_response.raise_for_status()
        emails_payload = emails_response.json()

    provider_user_id = user_payload.get("id")
    name = user_payload.get("name") or user_payload.get("login") or "GitHub User"
    email = None
    if isinstance(emails_payload, list):
        primary = next((entry for entry in emails_payload if entry.get("primary") and entry.get("verified")), None)
        fallback = next((entry for entry in emails_payload if entry.get("verified")), None)
        chosen = primary or fallback
        if isinstance(chosen, dict):
            email = chosen.get("email")

    if provider_user_id is None or not isinstance(email, str):
        raise HTTPException(status_code=502, detail="GitHub account is missing a verified email")

    return {"provider_user_id": str(provider_user_id), "email": email.lower(), "name": str(name)}
