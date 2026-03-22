#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VENV_DIR="${ROOT_DIR}/.venv"
UVICORN="${VENV_DIR}/bin/uvicorn"
CURL="$(command -v curl)"

if [[ ! -x "${UVICORN}" ]]; then
  echo "Missing ${UVICORN}. Run: make install"
  exit 1
fi

if [[ -z "${CURL}" ]]; then
  echo "curl is required"
  exit 1
fi

cleanup() {
  if [[ -n "${PROXY_PID:-}" ]]; then
    kill "${PROXY_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${MOCK_PID:-}" ]]; then
    kill "${MOCK_PID}" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

cd "${ROOT_DIR}"
rm -f smoke-test.db

"${UVICORN}" app.mock_provider:app --host 127.0.0.1 --port 8101 >/tmp/clawhelm-mock.log 2>&1 &
MOCK_PID=$!

PROVIDER_BASE_URL="http://127.0.0.1:8101" \
PROVIDER_API_KEY="local-test-key" \
CLAWHELM_DB_PATH="${ROOT_DIR}/smoke-test.db" \
"${UVICORN}" app.main:app --host 127.0.0.1 --port 8001 >/tmp/clawhelm-proxy.log 2>&1 &
PROXY_PID=$!

for _ in {1..40}; do
  if "${CURL}" -sf http://127.0.0.1:8001/health >/dev/null; then
    break
  fi
  sleep 0.25
done

echo "Running smoke test against local mock provider..."
"${CURL}" -s http://127.0.0.1:8001/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ignored-by-proxy" \
  -d '{
    "model": "gpt-4o-mini",
    "messages": [
      {"role": "user", "content": "hello smoke test"}
    ]
  }'

echo
echo "Recent logs:"
"${CURL}" -s http://127.0.0.1:8001/logs
