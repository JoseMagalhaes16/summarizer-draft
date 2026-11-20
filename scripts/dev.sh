#!/usr/bin/env bash
# Starts the fully mocked local stack:
#   - Python local API server on :8000 (LLM_PROVIDER=mock, in-memory/JSON storage, inline worker)
#   - Vite dev server on :5173 (proxies /v1 -> :8000)
# Ctrl+C stops both.
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

if [[ ! -x "$ROOT/backend/.venv/bin/python" ]]; then
  echo "Backend venv missing - run 'make install' first." >&2; exit 1
fi
if [[ ! -d "$ROOT/frontend/node_modules" ]]; then
  echo "Frontend deps missing - run 'make install' first." >&2; exit 1
fi

export LLM_PROVIDER="${LLM_PROVIDER:-mock}"
export STORAGE_BACKEND="${STORAGE_BACKEND:-memory}"
export JOB_DISPATCHER="${JOB_DISPATCHER:-inline}"
export LOCAL_DATA_FILE="${LOCAL_DATA_FILE:-$ROOT/backend/.local-data.json}"

cleanup() { trap - EXIT INT TERM; kill 0 2>/dev/null || true; }
trap cleanup EXIT INT TERM

echo "▶ API  http://localhost:8000/v1/health  (LLM_PROVIDER=$LLM_PROVIDER)"
( cd "$ROOT/backend" && .venv/bin/python -m vetscribe.local.server --host 127.0.0.1 --port 8000 ) &
echo "▶ UI   http://localhost:5173"
( cd "$ROOT/frontend" && npm run dev -- --host 127.0.0.1 --port 5173 --strictPort ) &
wait
