from __future__ import annotations

from datetime import datetime, timezone
from threading import Lock
from typing import Literal, TypedDict

FREE_DAILY_LIMIT = 20
UserPlan = Literal["free", "pro"]


class UserRecord(TypedDict):
    plan: UserPlan
    requests_today: int
    last_updated: str


users: dict[str, UserRecord] = {}
_user_lock = Lock()


def _current_date() -> str:
    return datetime.now(timezone.utc).date().isoformat()


def _ensure_user_unlocked(user_id: str) -> UserRecord:
    today = _current_date()
    user = users.get(user_id)
    if user is None:
        user = {"plan": "free", "requests_today": 0, "last_updated": today}
        users[user_id] = user
        return user

    if user["last_updated"] != today:
        user["requests_today"] = 0
        user["last_updated"] = today

    return user


def ensure_user(user_id: str) -> UserRecord:
    with _user_lock:
        return dict(_ensure_user_unlocked(user_id))


def check_usage(user_id: str) -> bool:
    with _user_lock:
        user = _ensure_user_unlocked(user_id)
        if user["plan"] == "pro":
            user["requests_today"] += 1
            return True
        if user["requests_today"] >= FREE_DAILY_LIMIT:
            return False
        user["requests_today"] += 1
        return True


def get_usage_summary(user_id: str) -> dict[str, int | str | None]:
    with _user_lock:
        user = _ensure_user_unlocked(user_id)
        remaining = None if user["plan"] == "pro" else max(FREE_DAILY_LIMIT - user["requests_today"], 0)
        return {
            "requests_today": user["requests_today"],
            "limit": FREE_DAILY_LIMIT,
            "remaining": remaining,
            "plan": user["plan"],
        }


def get_user_account(user_id: str) -> dict[str, int | str | None]:
    with _user_lock:
        user = _ensure_user_unlocked(user_id)
        remaining = None if user["plan"] == "pro" else max(FREE_DAILY_LIMIT - user["requests_today"], 0)
        return {
            "user_id": user_id,
            "plan": user["plan"],
            "requests_today": user["requests_today"],
            "limit": FREE_DAILY_LIMIT,
            "remaining": remaining,
            "last_updated": user["last_updated"],
        }


def upgrade_user_to_pro(user_id: str) -> UserRecord:
    with _user_lock:
        user = _ensure_user_unlocked(user_id)
        user["plan"] = "pro"
        return dict(user)


def reset_usage_store() -> None:
    with _user_lock:
        users.clear()
