#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SELF_NAME="$(basename "$0")"
MARKER_FILE="$ROOT_DIR/state/live_follow_runtime_root.txt"
if [[ "${LIVE_FOLLOW_NO_DELEGATE:-0}" != "1" && -f "$MARKER_FILE" ]]; then
  DELEGATE_ROOT="$(tr -d '\r' < "$MARKER_FILE" | head -n 1)"
  if [[ -n "${DELEGATE_ROOT:-}" && "$DELEGATE_ROOT" != "$ROOT_DIR" && -x "$DELEGATE_ROOT/scripts/$SELF_NAME" ]]; then
    exec "$DELEGATE_ROOT/scripts/$SELF_NAME"
  fi
fi
LOG_DIR="$ROOT_DIR/logs"
ENV_FILE="$ROOT_DIR/.env"
QUEUE_FILE="${LIVE_FOLLOW_SIGNAL_QUEUE_FILE:-$ROOT_DIR/logs/live_follow_signal_queue.ndjson}"
LEGACY_SESSION="${LIVE_FOLLOW_SCREEN_SESSION:-polymarket_live_follow}"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

ENABLE_VAL_REFRESH="${LIVE_FOLLOW_ENABLE_VALUATION_REFRESH:-1}"
ENABLE_HOURLY_REPORT="${LIVE_FOLLOW_ENABLE_HOURLY_REPORT:-1}"
PERSISTENT_RUNTIME="${LIVE_FOLLOW_PERSISTENT_RUNTIME:-0}"

persistent_lc="$(printf '%s' "$PERSISTENT_RUNTIME" | tr '[:upper:]' '[:lower:]')"
if [[ "$persistent_lc" == "1" || "$persistent_lc" == "true" ]]; then
  runtime_status="$("$ROOT_DIR/scripts/live_follow_persistent_status.sh")"
else
  runtime_status="$("$ROOT_DIR/scripts/live_follow_ingest_status.sh")"$'\n'"$("$ROOT_DIR/scripts/live_follow_consume_status.sh")"
fi
val_lc="$(printf '%s' "$ENABLE_VAL_REFRESH" | tr '[:upper:]' '[:lower:]')"
if [[ "$val_lc" == "1" || "$val_lc" == "true" ]]; then
  valuation_status="$("$ROOT_DIR/scripts/live_follow_valuation_refresh_status.sh")"
else
  valuation_status="valuation_refresh status=disabled"
fi
hourly_lc="$(printf '%s' "$ENABLE_HOURLY_REPORT" | tr '[:upper:]' '[:lower:]')"
if [[ "$hourly_lc" == "1" || "$hourly_lc" == "true" ]]; then
  hourly_status="$("$ROOT_DIR/scripts/live_follow_hourly_report_status.sh")"
else
  hourly_status="live_follow_hourly_report status=disabled"
fi

queue_summary="$(python3 - "$QUEUE_FILE" <<'PY'
import json, sys
from pathlib import Path
p = Path(sys.argv[1])
count = 0
leaders = {}
if p.exists():
    with p.open('r', encoding='utf-8') as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            count += 1
            try:
                obj = json.loads(line)
            except Exception:
                continue
            leader = str(obj.get('leader_id','')).strip().lower()
            if leader:
                leaders[leader] = leaders.get(leader, 0) + 1
parts = [f'total={count}']
for leader, n in sorted(leaders.items()):
    parts.append(f'{leader}:{n}')
print('signal_queue ' + ' '.join(parts))
PY
)"

legacy_state="legacy_direct status=stopped"
if command -v screen >/dev/null 2>&1; then
  if screen -ls 2>/dev/null | grep -Eq "[[:space:]]+[0-9]+\\.${LEGACY_SESSION}[[:space:]]"; then
    legacy_state="legacy_direct status=running screen_session=$LEGACY_SESSION"
  fi
fi

printf '%s\n%s\n%s\n%s\n%s\n' "$runtime_status" "$valuation_status" "$hourly_status" "$queue_summary" "$legacy_state"
