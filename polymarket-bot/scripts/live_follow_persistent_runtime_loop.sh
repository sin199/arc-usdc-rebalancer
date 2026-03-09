#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
PY_SCRIPT="$ROOT_DIR/scripts/live/live_follow_persistent_runtime.py"
PY_BIN="${LIVE_FOLLOW_PYTHON:-python3}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

exec "$PY_BIN" "$PY_SCRIPT"
