#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/state"
LOG_DIR="$ROOT_DIR/logs"
PID_FILE="$STATE_DIR/live_follow_persistent.pid"
MODE_FILE="$STATE_DIR/live_follow_persistent.mode"
RUN_LOG="$LOG_DIR/live_follow_persistent.log"
ENV_FILE="$ROOT_DIR/.env"
STATUS_JSON="$LOG_DIR/live_follow_persistent_runtime_latest.json"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

session="${LIVE_FOLLOW_PERSISTENT_SCREEN_SESSION:-polymarket_live_follow_persistent}"
if command -v screen >/dev/null 2>&1; then
  if screen -ls 2>/dev/null | grep -Eq "[[:space:]]+[0-9]+\\.${session}[[:space:]]"; then
    screen_pid="$(screen -ls 2>/dev/null | awk -v s="$session" '$1 ~ ("\\." s "$") {split($1,a,"."); print a[1]; exit}' || true)"
    [[ -n "${screen_pid:-}" ]] && echo "$screen_pid" > "$PID_FILE"
    mode="$(cat "$MODE_FILE" 2>/dev/null || echo screen_persistent)"
    summary=""
    if [[ -f "$STATUS_JSON" ]]; then
      summary="$(python3 - "$STATUS_JSON" <<'PY'
import json, sys
from pathlib import Path
p = Path(sys.argv[1])
try:
    obj = json.loads(p.read_text(encoding='utf-8'))
except Exception:
    obj = {}
parts = [f"pending_total={int(obj.get('pending_total', 0))}"]
for leader, count in sorted((obj.get('pending_by_leader') or {}).items()):
    parts.append(f"{leader}:{int(count)}")
print(' '.join(parts))
PY
)"
    fi
    echo "live_follow_persistent status=running pid=${screen_pid:-unknown} mode=${mode:-screen_persistent} screen_session=$session log=$RUN_LOG ${summary:-}" | sed 's/  */ /g'
    exit 0
  fi
fi

if [[ ! -f "$PID_FILE" ]]; then
  echo "live_follow_persistent status=stopped"
  exit 0
fi

pid="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -z "${pid:-}" ]]; then
  echo "live_follow_persistent status=stopped reason=empty_pid_file"
  exit 0
fi

if kill -0 "$pid" 2>/dev/null; then
  mode="$(cat "$MODE_FILE" 2>/dev/null || echo unknown)"
  echo "live_follow_persistent status=running pid=$pid mode=$mode log=$RUN_LOG"
  exit 0
fi

rm -f "$PID_FILE" "$MODE_FILE"
echo "live_follow_persistent status=stopped reason=stale_pid pid=$pid"
exit 0
