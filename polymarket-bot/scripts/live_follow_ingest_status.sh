#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STATE_DIR="$ROOT_DIR/state"
LOG_DIR="$ROOT_DIR/logs"
PID_FILE="$STATE_DIR/live_follow_ingest.pid"
MODE_FILE="$STATE_DIR/live_follow_ingest.mode"
RUN_LOG="$LOG_DIR/live_follow_ingest.log"
ENV_FILE="$ROOT_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

label_base="${LIVE_FOLLOW_LAUNCHD_LABEL_BASE:-${LIVE_FOLLOW_LAUNCHD_LABEL:-com.xyu.polymarket.livefollow}}"
launchd_label="${LIVE_FOLLOW_INGEST_LAUNCHD_LABEL:-$label_base.ingest}"
launchd_plist="$HOME/Library/LaunchAgents/$launchd_label.plist"
launchd_tmp="/tmp/.${launchd_label//./_}_status.$$"

if [[ -f "$launchd_plist" ]]; then
  if launchctl print "gui/$UID/$launchd_label" >"$launchd_tmp" 2>&1; then
    state="$(awk -F'= ' '/state =/ {print $2; exit}' "$launchd_tmp" | tr -d ';' || true)"
    pid="$(awk -F'= ' '/pid =/ {print $2; exit}' "$launchd_tmp" | tr -d ';' || true)"
    rm -f "$launchd_tmp"
    echo "live_follow_ingest status=running pid=${pid:-none} mode=launchd state=${state:-unknown} label=$launchd_label log=$RUN_LOG"
    exit 0
  fi
  rm -f "$launchd_tmp" >/dev/null 2>&1 || true
fi

session="${LIVE_FOLLOW_INGEST_SCREEN_SESSION:-polymarket_live_follow_ingest}"
if command -v screen >/dev/null 2>&1; then
  if screen -ls 2>/dev/null | grep -Eq "[[:space:]]+[0-9]+\\.${session}[[:space:]]"; then
    screen_pid="$(screen -ls 2>/dev/null | awk -v s="$session" '$1 ~ ("\\." s "$") {split($1,a,"."); print a[1]; exit}' || true)"
    mode="$(cat "$MODE_FILE" 2>/dev/null || echo screen)"
    [[ -n "${screen_pid:-}" ]] && echo "$screen_pid" > "$PID_FILE"
    echo "live_follow_ingest status=running pid=${screen_pid:-unknown} mode=${mode:-screen} screen_session=$session log=$RUN_LOG"
    exit 0
  fi
fi

if [[ ! -f "$PID_FILE" ]]; then
  echo "live_follow_ingest status=stopped"
  exit 0
fi

pid="$(cat "$PID_FILE" 2>/dev/null || true)"
if [[ -z "${pid:-}" ]]; then
  echo "live_follow_ingest status=stopped reason=empty_pid_file"
  exit 0
fi

if kill -0 "$pid" 2>/dev/null; then
  mode="$(cat "$MODE_FILE" 2>/dev/null || echo unknown)"
  echo "live_follow_ingest status=running pid=$pid mode=$mode log=$RUN_LOG"
  exit 0
fi

rm -f "$PID_FILE" "$MODE_FILE"
echo "live_follow_ingest status=stopped reason=stale_pid pid=$pid"
exit 0
