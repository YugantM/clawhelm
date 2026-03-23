from __future__ import annotations

import argparse
import asyncio
import os
import sys
from pathlib import Path
from secrets import token_urlsafe

ROOT = Path(__file__).resolve().parent.parent
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))

from app.auth import build_password_hash  # noqa: E402
from app.db import db  # noqa: E402


async def main() -> None:
    parser = argparse.ArgumentParser(description="Create or update a local ClawHelm superuser")
    parser.add_argument("--email", default="admin@clawhelm.local")
    parser.add_argument("--name", default="ClawHelm Admin")
    parser.add_argument("--password", default="")
    args = parser.parse_args()

    password = args.password or token_urlsafe(12)

    await db.init()
    user = await db.upsert_local_superuser(
        email=args.email,
        name=args.name,
        password_hash=build_password_hash(password),
        plan="pro",
    )

    print(f"email={user['email']}")
    print(f"password={password}")
    print(f"user_id={user['id']}")
    print("plan=pro")
    print("is_superuser=true")


if __name__ == "__main__":
    asyncio.run(main())
