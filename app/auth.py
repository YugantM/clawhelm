from __future__ import annotations

import hashlib
import os
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any

import jwt


class JWTManager:
    def __init__(
        self,
        secret_key: str | None = None,
        algorithm: str = "HS256",
        expires_in_seconds: int = 30 * 24 * 3600,
    ):
        self.secret_key = secret_key or os.getenv("JWT_SECRET_KEY", "secret-dev-key")
        self.algorithm = algorithm
        self.expires_in_seconds = expires_in_seconds

    def create_token(self, user_id: int, expires_in: int | None = None) -> str:
        expires_in = expires_in or self.expires_in_seconds
        now = datetime.now(timezone.utc)
        payload = {
            "user_id": user_id,
            "iat": now,
            "exp": now + timedelta(seconds=expires_in),
        }
        return jwt.encode(payload, self.secret_key, algorithm=self.algorithm)

    def verify_token(self, token: str) -> dict[str, Any] | None:
        try:
            payload = jwt.decode(token, self.secret_key, algorithms=[self.algorithm])
            return payload
        except jwt.InvalidTokenError:
            return None

    def refresh_token(self, old_token: str) -> str | None:
        payload = self.verify_token(old_token)
        if payload:
            return self.create_token(payload["user_id"])
        return None


jwt_manager = JWTManager()


def hash_password(password: str) -> str:
    salt = secrets.token_hex(16)
    hashed = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260000)
    return f"{salt}:{hashed.hex()}"


def verify_password(password: str, stored_hash: str) -> bool:
    try:
        salt, hashed = stored_hash.split(":", 1)
        check = hashlib.pbkdf2_hmac("sha256", password.encode(), salt.encode(), 260000)
        return check.hex() == hashed
    except Exception:
        return False
