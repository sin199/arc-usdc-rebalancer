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
LOG_DIR="$ROOT_DIR/logs"
ENV_FILE="$ROOT_DIR/.env"
LEGACY_PID_FILE="$STATE_DIR/live_follow.pid"
LEGACY_MODE_FILE="$STATE_DIR/live_follow.mode"
LEGACY_LOOP_SCRIPT="$ROOT_DIR/scripts/live_follow_loop.sh"
LEGACY_WORKER_PATTERN="$ROOT_DIR/scripts/live/live_follow_sports_local.py --leader-address"
LEGACY_SESSION="${LIVE_FOLLOW_SCREEN_SESSION:-polymarket_live_follow}"

mkdir -p "$STATE_DIR" "$LOG_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

ENABLE_VAL_REFRESH="${LIVE_FOLLOW_ENABLE_VALUATION_REFRESH:-1}"
ENABLE_HOURLY_REPORT="${LIVE_FOLLOW_ENABLE_HOURLY_REPORT:-1}"
PERSISTENT_RUNTIME="${LIVE_FOLLOW_PERSISTENT_RUNTIME:-0}"

LABEL_BASE="${LIVE_FOLLOW_LAUNCHD_LABEL_BASE:-${LIVE_FOLLOW_LAUNCHD_LABEL:-com.xyu.polymarket.livefollow}}"
INGEST_LAUNCHD_LABEL="${LIVE_FOLLOW_INGEST_LAUNCHD_LABEL:-$LABEL_BASE.ingest}"
CONSUME_LAUNCHD_LABEL="${LIVE_FOLLOW_CONSUME_LAUNCHD_LABEL:-$LABEL_BASE.consume}"
VALUATION_LAUNCHD_LABEL="${LIVE_FOLLOW_VALUATION_REFRESH_LAUNCHD_LABEL:-$LABEL_BASE.valuation}"
START_ALLOW_WITH_LAUNCHD="${LIVE_FOLLOW_START_ALLOW_WITH_LAUNCHD:-0}"

launchd_loaded=0
for label in "$INGEST_LAUNCHD_LABEL" "$CONSUME_LAUNCHD_LABEL" "$VALUATION_LAUNCHD_LABEL"; do
  if launchctl print "gui/$UID/$label" >/dev/null 2>&1; then
    launchd_loaded=1
    break
  fi
done

if (( launchd_loaded )) && [[ "$START_ALLOW_WITH_LAUNCHD" != "1" ]]; then
  "$ROOT_DIR/scripts/live_follow_launchd_status.sh"
  echo "live_follow start skipped reason=launchd_managed"
  exit 0
fi

# Stop legacy direct-loop runtime if it is still around.
if command -v screen >/dev/null 2>&1; then
  if screen -ls 2>/dev/null | grep -Eq "[[:space:]]+[0-9]+\\.${LEGACY_SESSION}[[:space:]]"; then
    screen -S "$LEGACY_SESSION" -X quit >/dev/null 2>&1 || true
    sleep 1
  fi
fi
pkill -f "$LEGACY_LOOP_SCRIPT" >/dev/null 2>&1 || true
pkill -f "$LEGACY_WORKER_PATTERN" >/dev/null 2>&1 || true
rm -f "$LEGACY_PID_FILE" "$LEGACY_MODE_FILE"

"$ROOT_DIR/scripts/live_follow_persistent_stop.sh" >/dev/null 2>&1 || true
"$ROOT_DIR/scripts/live_follow_ingest_stop.sh" >/dev/null 2>&1 || true
"$ROOT_DIR/scripts/live_follow_consume_stop.sh" >/dev/null 2>&1 || true

persistent_lc="$(printf '%s' "$PERSISTENT_RUNTIME" | tr '[:upper:]' '[:lower:]')"
if [[ "$persistent_lc" == "1" || "$persistent_lc" == "true" ]]; then
  "$ROOT_DIR/scripts/live_follow_persistent_start.sh"
else
  "$ROOT_DIR/scripts/live_follow_ingest_start.sh"
  "$ROOT_DIR/scripts/live_follow_consume_start.sh"
fi

val_lc="$(printf '%s' "$ENABLE_VAL_REFRESH" | tr '[:upper:]' '[:lower:]')"
if [[ "$val_lc" == "1" || "$val_lc" == "true" ]]; then
  "$ROOT_DIR/scripts/live_follow_valuation_refresh_start.sh"
fi

hourly_lc="$(printf '%s' "$ENABLE_HOURLY_REPORT" | tr '[:upper:]' '[:lower:]')"
if [[ "$hourly_lc" == "1" || "$hourly_lc" == "true" ]]; then
  "$ROOT_DIR/scripts/live_follow_hourly_report_start.sh"
fi

if [[ "$persistent_lc" == "1" || "$persistent_lc" == "true" ]]; then
  runtime_status="$("$ROOT_DIR/scripts/live_follow_persistent_status.sh")"
else
  runtime_status="$("$ROOT_DIR/scripts/live_follow_ingest_status.sh")"$'\n'"$("$ROOT_DIR/scripts/live_follow_consume_status.sh")"
fi
if [[ "$val_lc" == "1" || "$val_lc" == "true" ]]; then
  valuation_status="$("$ROOT_DIR/scripts/live_follow_valuation_refresh_status.sh")"
else
  valuation_status="valuation_refresh status=disabled"
fi
if [[ "$hourly_lc" == "1" || "$hourly_lc" == "true" ]]; then
  hourly_status="$("$ROOT_DIR/scripts/live_follow_hourly_report_status.sh")"
else
  hourly_status="live_follow_hourly_report status=disabled"
fi

printf '%s\n%s\n%s\n' "$runtime_status" "$valuation_status" "$hourly_status"
