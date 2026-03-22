#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="${ROOT_DIR}/frontend"
BACKEND_HOST="${BACKEND_HOST:-127.0.0.1}"
BACKEND_PORT="${BACKEND_PORT:-8000}"
FRONTEND_HOST="${FRONTEND_HOST:-127.0.0.1}"
FRONTEND_PORT="${FRONTEND_PORT:-5173}"
API_BASE_URL="http://${BACKEND_HOST}:${BACKEND_PORT}"
BACKEND_LOG="${ROOT_DIR}/.backend-dev.log"
FRONTEND_LOG="${ROOT_DIR}/.frontend-dev.log"

cleanup() {
  local exit_code=$?
  if [[ -n "${FRONTEND_PID:-}" ]] && kill -0 "${FRONTEND_PID}" >/dev/null 2>&1; then
    kill "${FRONTEND_PID}" >/dev/null 2>&1 || true
  fi
  if [[ -n "${BACKEND_PID:-}" ]] && kill -0 "${BACKEND_PID}" >/dev/null 2>&1; then
    kill "${BACKEND_PID}" >/dev/null 2>&1 || true
  fi
  wait >/dev/null 2>&1 || true
  exit "${exit_code}"
}
trap cleanup EXIT INT TERM

if [[ ! -x "${ROOT_DIR}/.venv/bin/uvicorn" ]]; then
  echo "Missing backend virtualenv. Run: make install"
  exit 1
fi

if [[ ! -d "${FRONTEND_DIR}/node_modules" ]]; then
  echo "Missing frontend dependencies. Run: cd frontend && npm install"
  exit 1
fi

echo "Starting backend on ${API_BASE_URL}"
(
  cd "${ROOT_DIR}"
  export PYTHONPATH="${ROOT_DIR}"
  source "${ROOT_DIR}/.venv/bin/activate"
  uvicorn app.main:app --host "${BACKEND_HOST}" --port "${BACKEND_PORT}" --reload
) >"${BACKEND_LOG}" 2>&1 &
BACKEND_PID=$!

for _ in {1..40}; do
  if curl -sf "${API_BASE_URL}/health" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

if ! curl -sf "${API_BASE_URL}/health" >/dev/null 2>&1; then
  echo "Backend failed to start. See ${BACKEND_LOG}"
  exit 1
fi

echo "Starting frontend on http://${FRONTEND_HOST}:${FRONTEND_PORT}"
(
  cd "${FRONTEND_DIR}"
  unset VITE_API_BASE_URL
  export VITE_API_PROXY_TARGET="${API_BASE_URL}"
  npm run dev -- --host "${FRONTEND_HOST}" --port "${FRONTEND_PORT}"
) >"${FRONTEND_LOG}" 2>&1 &
FRONTEND_PID=$!

for _ in {1..40}; do
  if curl -sf "http://${FRONTEND_HOST}:${FRONTEND_PORT}" >/dev/null 2>&1; then
    break
  fi
  sleep 0.25
done

if ! curl -sf "http://${FRONTEND_HOST}:${FRONTEND_PORT}" >/dev/null 2>&1; then
  echo "Frontend failed to start. See ${FRONTEND_LOG}"
  exit 1
fi

echo
echo "Dashboard is ready:"
echo "  Frontend: http://${FRONTEND_HOST}:${FRONTEND_PORT}"
echo "  Backend:  ${API_BASE_URL}"
echo
echo "Logs:"
echo "  ${BACKEND_LOG}"
echo "  ${FRONTEND_LOG}"
echo
echo "Press Ctrl+C to stop both services."

wait "${BACKEND_PID}" "${FRONTEND_PID}"
