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
STATE_DIR="$ROOT_DIR/state"
ENV_FILE="$ROOT_DIR/.env"
LEGACY_PID_FILE="$STATE_DIR/live_follow.pid"
LEGACY_MODE_FILE="$STATE_DIR/live_follow.mode"
LEGACY_LOOP_SCRIPT="$ROOT_DIR/scripts/live_follow_loop.sh"
LEGACY_WORKER_PATTERN="$ROOT_DIR/scripts/live/live_follow_sports_local.py --leader-address"
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

"$ROOT_DIR/scripts/live_follow_persistent_stop.sh" >/dev/null 2>&1 || true
"$ROOT_DIR/scripts/live_follow_ingest_stop.sh" >/dev/null 2>&1 || true
"$ROOT_DIR/scripts/live_follow_consume_stop.sh" >/dev/null 2>&1 || true

val_lc="$(printf '%s' "$ENABLE_VAL_REFRESH" | tr '[:upper:]' '[:lower:]')"
if [[ "$val_lc" == "1" || "$val_lc" == "true" ]]; then
  "$ROOT_DIR/scripts/live_follow_valuation_refresh_stop.sh" >/dev/null 2>&1 || true
fi
hourly_lc="$(printf '%s' "$ENABLE_HOURLY_REPORT" | tr '[:upper:]' '[:lower:]')"
if [[ "$hourly_lc" == "1" || "$hourly_lc" == "true" ]]; then
  "$ROOT_DIR/scripts/live_follow_hourly_report_stop.sh" >/dev/null 2>&1 || true
fi

if command -v screen >/dev/null 2>&1; then
  if screen -ls 2>/dev/null | grep -Eq "[[:space:]]+[0-9]+\\.${LEGACY_SESSION}[[:space:]]"; then
    screen -S "$LEGACY_SESSION" -X quit >/dev/null 2>&1 || true
    sleep 1
  fi
fi
pkill -f "$LEGACY_LOOP_SCRIPT" >/dev/null 2>&1 || true
pkill -f "$LEGACY_WORKER_PATTERN" >/dev/null 2>&1 || true
rm -f "$LEGACY_PID_FILE" "$LEGACY_MODE_FILE"

echo "live_follow stack stopped"
