from __future__ import annotations

import hashlib
import hmac
import os
from datetime import datetime, timedelta, timezone
from secrets import token_hex, token_urlsafe

AUTH_COOKIE_NAME = "clawhelm_session"
SESSION_TTL_DAYS = int(os.getenv("SESSION_TTL_DAYS", "30"))


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def isoformat(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat()


def build_password_hash(password: str) -> str:
    salt = token_hex(16)
    derived_key = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 200_000)
    return f"{salt}${derived_key.hex()}"


def verify_password(password: str, password_hash: str | None) -> bool:
    if not password_hash or "$" not in password_hash:
        return False
    salt, stored_hash = password_hash.split("$", 1)
    candidate_hash = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt.encode("utf-8"), 200_000).hex()
    return hmac.compare_digest(candidate_hash, stored_hash)


def generate_session_token() -> str:
    return token_urlsafe(32)


def hash_session_token(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def get_session_expiry() -> datetime:
    return utcnow() + timedelta(days=SESSION_TTL_DAYS)


def is_secure_cookie(frontend_base_url: str | None) -> bool:
    if not frontend_base_url:
        return False
    return frontend_base_url.startswith("https://")


def cookie_samesite(frontend_base_url: str | None) -> str:
    return "none" if is_secure_cookie(frontend_base_url) else "lax"
