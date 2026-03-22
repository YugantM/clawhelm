from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
SETTINGS_PATH = ROOT / ".clawhelm" / "settings.json"
ENV_EXAMPLE = ROOT / ".env.example"
ENV_FILE = ROOT / ".env"
FRONTEND_DIR = ROOT / "frontend"


def run(cmd: list[str], *, cwd: Path | None = None) -> None:
    print(f"$ {' '.join(cmd)}")
    subprocess.run(cmd, cwd=str(cwd) if cwd else None, check=True)


def ensure_env_file() -> None:
    if ENV_FILE.exists() or not ENV_EXAMPLE.exists():
        return
    shutil.copyfile(ENV_EXAMPLE, ENV_FILE)
    print(f"Created {ENV_FILE}")


def ensure_settings_file(openrouter_api_key: str | None) -> None:
    SETTINGS_PATH.parent.mkdir(parents=True, exist_ok=True)
    if SETTINGS_PATH.exists():
        payload = json.loads(SETTINGS_PATH.read_text())
    else:
        payload = {"providers": {"openrouter": {"api_key": ""}, "openai": {"api_key": ""}}}

    payload.setdefault("providers", {})
    payload["providers"].setdefault("openrouter", {"api_key": ""})
    payload["providers"].setdefault("openai", {"api_key": ""})
    if openrouter_api_key:
        payload["providers"]["openrouter"]["api_key"] = openrouter_api_key.strip()

    SETTINGS_PATH.write_text(json.dumps(payload, indent=2) + "\n")
    print(f"Updated {SETTINGS_PATH}")


def ensure_backend_dependencies() -> None:
    venv_dir = ROOT / ".venv"
    if not venv_dir.exists():
        run([sys.executable, "-m", "venv", str(venv_dir)])
    pip = venv_dir / ("Scripts" if os.name == "nt" else "bin") / ("pip.exe" if os.name == "nt" else "pip")
    run([str(pip), "install", "-r", str(ROOT / "requirements.txt")])


def ensure_frontend_dependencies() -> None:
    npm = shutil.which("npm")
    if not npm:
        print("Skipping frontend install because npm was not found on PATH.")
        return
    run([npm, "install"], cwd=FRONTEND_DIR)


def main() -> None:
    parser = argparse.ArgumentParser(description="Install ClawHelm with minimal setup.")
    parser.add_argument("--openrouter-api-key", default=os.getenv("OPENROUTER_API_KEY", ""), help="Persist an OpenRouter API key into .clawhelm/settings.json")
    parser.add_argument("--skip-frontend", action="store_true", help="Skip npm install in frontend/")
    parser.add_argument("--skip-backend", action="store_true", help="Skip Python venv + pip install")
    args = parser.parse_args()

    os.chdir(ROOT)
    ensure_env_file()
    ensure_settings_file(args.openrouter_api_key or None)
    if not args.skip_backend:
        ensure_backend_dependencies()
    if not args.skip_frontend:
        ensure_frontend_dependencies()

    print("\nClawHelm install complete.")
    print("Next steps:")
    print("  1. Start the local stack: ./scripts/run_dashboard.sh")
    print("  2. Open http://127.0.0.1:5173")
    print("  3. Add or update your OpenRouter API key from Dashboard -> Provider Keys")


if __name__ == "__main__":
    main()
