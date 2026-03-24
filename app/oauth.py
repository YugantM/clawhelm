from __future__ import annotations

import asyncio
import os
from abc import ABC, abstractmethod
from typing import Any

import httpx


class OAuthClient(ABC):
    def __init__(
        self,
        provider: str,
        client_id: str,
        client_secret: str,
        redirect_uri: str,
    ):
        self.provider = provider
        self.client_id = client_id
        self.client_secret = client_secret
        self.redirect_uri = redirect_uri

    @abstractmethod
    def get_authorization_url(self, state: str) -> str:
        pass

    @abstractmethod
    async def exchange_code_for_token(self, code: str) -> dict[str, Any]:
        pass

    @abstractmethod
    async def get_user_info(self, access_token: str) -> dict[str, Any]:
        pass


class GoogleOAuthClient(OAuthClient):
    AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth"
    TOKEN_URL = "https://oauth2.googleapis.com/token"
    USERINFO_URL = "https://openidconnect.googleapis.com/v1/userinfo"
    SCOPES = ["openid", "email", "profile"]

    def get_authorization_url(self, state: str) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "response_type": "code",
            "scope": " ".join(self.SCOPES),
            "state": state,
            "access_type": "offline",
        }
        query_string = "&".join(f"{k}={v}" for k, v in params.items())
        return f"{self.AUTHORIZE_URL}?{query_string}"

    async def exchange_code_for_token(self, code: str) -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.TOKEN_URL,
                data={
                    "code": code,
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "redirect_uri": self.redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
            response.raise_for_status()
            return response.json()

    async def get_user_info(self, access_token: str) -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            response = await client.get(
                self.USERINFO_URL,
                headers={"Authorization": f"Bearer {access_token}"},
            )
            response.raise_for_status()
            data = response.json()
            return {
                "provider_user_id": data["sub"],
                "email": data["email"],
                "name": data.get("name"),
                "avatar_url": data.get("picture"),
            }


class GitHubOAuthClient(OAuthClient):
    AUTHORIZE_URL = "https://github.com/login/oauth/authorize"
    TOKEN_URL = "https://github.com/login/oauth/access_token"
    USERINFO_URL = "https://api.github.com/user"
    EMAIL_URL = "https://api.github.com/user/emails"
    SCOPES = ["user:email"]

    def get_authorization_url(self, state: str) -> str:
        params = {
            "client_id": self.client_id,
            "redirect_uri": self.redirect_uri,
            "scope": ",".join(self.SCOPES),
            "state": state,
        }
        query_string = "&".join(f"{k}={v}" for k, v in params.items())
        return f"{self.AUTHORIZE_URL}?{query_string}"

    async def exchange_code_for_token(self, code: str) -> dict[str, Any]:
        async with httpx.AsyncClient() as client:
            response = await client.post(
                self.TOKEN_URL,
                data={
                    "code": code,
                    "client_id": self.client_id,
                    "client_secret": self.client_secret,
                    "redirect_uri": self.redirect_uri,
                },
                headers={"Accept": "application/json"},
            )
            response.raise_for_status()
            return response.json()

    async def get_user_info(self, access_token: str) -> dict[str, Any]:
        headers = {
            "Authorization": f"Bearer {access_token}",
            "Accept": "application/vnd.github.v3+json",
        }
        async with httpx.AsyncClient() as client:
            user_response = await client.get(self.USERINFO_URL, headers=headers)
            user_response.raise_for_status()
            user_data = user_response.json()

            email_response = await client.get(self.EMAIL_URL, headers=headers)
            email_response.raise_for_status()
            email_data = email_response.json()

            primary_email = next(
                (e["email"] for e in email_data if e["primary"]), email_data[0]["email"] if email_data else None
            )

            return {
                "provider_user_id": str(user_data["id"]),
                "email": primary_email or user_data.get("email"),
                "name": user_data.get("name"),
                "avatar_url": user_data.get("avatar_url"),
            }


def create_oauth_client(provider: str) -> OAuthClient | None:
    if provider == "google":
        # Support both Railway naming (GOOGLE_CLIENT_ID) and explicit naming
        client_id = os.getenv("GOOGLE_CLIENT_ID") or os.getenv("GOOGLE_OAUTH_CLIENT_ID")
        client_secret = os.getenv("GOOGLE_CLIENT_SECRET") or os.getenv("GOOGLE_OAUTH_CLIENT_SECRET")
        redirect_uri = os.getenv("GOOGLE_OAUTH_REDIRECT_URI", "http://localhost:8000/auth/google/callback")
        if client_id and client_secret:
            return GoogleOAuthClient(provider, client_id, client_secret, redirect_uri)
    elif provider == "github":
        # Support both Railway naming (GITHUB_CLIENT_ID) and explicit naming
        client_id = os.getenv("GITHUB_CLIENT_ID") or os.getenv("GITHUB_OAUTH_CLIENT_ID")
        client_secret = os.getenv("GITHUB_CLIENT_SECRET") or os.getenv("GITHUB_OAUTH_CLIENT_SECRET")
        redirect_uri = os.getenv("GITHUB_OAUTH_REDIRECT_URI", "http://localhost:8000/auth/github/callback")
        if client_id and client_secret:
            return GitHubOAuthClient(provider, client_id, client_secret, redirect_uri)
    return None
