#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

PY_SCRIPT="$ROOT_DIR/scripts/live/paper_follow_sports_local.py"
PY_BIN="${PAPER_FOLLOW_PYTHON:-python3}"

USERNAME="${PAPER_FOLLOW_USERNAME:-swisstony}"
LEADER_ADDRESS="${PAPER_FOLLOW_LEADER_ADDRESS:-}"
BANKROLL="${PAPER_FOLLOW_BANKROLL_USDC:-1000}"
FETCH_LIMIT="${PAPER_FOLLOW_FETCH_LIMIT:-200}"
INTERVAL="${PAPER_FOLLOW_INTERVAL_SECONDS:-45}"
LOOP="${PAPER_FOLLOW_LOOP:-0}"

EDGE_THRESHOLD="${PAPER_FOLLOW_EDGE_THRESHOLD:-0.02}"
MIN_CONFIDENCE="${PAPER_FOLLOW_MIN_CONFIDENCE:-0.55}"
MIN_LIQUIDITY="${PAPER_FOLLOW_MIN_LIQUIDITY:-500}"
ALLOW_NEAR_RESOLUTION="${PAPER_FOLLOW_ALLOW_NEAR_RESOLUTION:-0}"
NEAR_RES_MINUTES="${PAPER_FOLLOW_NEAR_RESOLUTION_BLOCK_MINUTES:-5}"
KELLY_FRACTION="${PAPER_FOLLOW_KELLY_FRACTION:-0.25}"
HARD_CAP_PCT="${PAPER_FOLLOW_HARD_CAP_PER_MARKET_PCT:-0.03}"
DAILY_DD_STOP="${PAPER_FOLLOW_DAILY_DRAWDOWN_STOP_PCT:-0.10}"
VOL_TOL="${PAPER_FOLLOW_BANKROLL_VOLATILITY_TOLERANCE_PCT:-0.20}"
FAIL_HALT="${PAPER_FOLLOW_EXEC_FAILURE_HALT_PCT:-0.20}"
MIN_ORDER_USDC="${PAPER_FOLLOW_MIN_ORDER_USDC:-1.0}"

STATE_FILE="${PAPER_FOLLOW_STATE_FILE:-$ROOT_DIR/state/paper_follow_sports_state.json}"
LATEST_FILE="${PAPER_FOLLOW_LATEST_FILE:-$ROOT_DIR/logs/paper_follow_sports_latest.json}"
EVENTS_FILE="${PAPER_FOLLOW_EVENTS_FILE:-$ROOT_DIR/logs/paper_follow_sports_events.ndjson}"
NOTIFY_TELEGRAM="${PAPER_FOLLOW_NOTIFY_TELEGRAM:-0}"
TELEGRAM_BOT_TOKEN="${PAPER_FOLLOW_TELEGRAM_BOT_TOKEN:-${TELEGRAM_BOT_TOKEN:-${TG_BOT_TOKEN:-${BOT_TOKEN:-}}}}"
TELEGRAM_CHAT_ID="${PAPER_FOLLOW_TELEGRAM_CHAT_ID:-${TELEGRAM_CHAT_ID:-${TG_CHAT_ID:-${CHAT_ID:-}}}}"

args=(
  "$PY_SCRIPT"
  --username "$USERNAME"
  --bankroll "$BANKROLL"
  --fetch-limit "$FETCH_LIMIT"
  --edge-threshold "$EDGE_THRESHOLD"
  --min-confidence "$MIN_CONFIDENCE"
  --min-liquidity "$MIN_LIQUIDITY"
  --near-resolution-block-minutes "$NEAR_RES_MINUTES"
  --kelly-fraction "$KELLY_FRACTION"
  --hard-cap-per-market-pct "$HARD_CAP_PCT"
  --daily-drawdown-stop-pct "$DAILY_DD_STOP"
  --bankroll-volatility-tolerance-pct "$VOL_TOL"
  --execution-failure-halt-pct "$FAIL_HALT"
  --min-order-usdc "$MIN_ORDER_USDC"
  --interval-seconds "$INTERVAL"
  --state-file "$STATE_FILE"
  --latest-file "$LATEST_FILE"
  --events-file "$EVENTS_FILE"
)

if [[ -n "$LEADER_ADDRESS" ]]; then
  args+=(--leader-address "$LEADER_ADDRESS")
fi

if [[ "$ALLOW_NEAR_RESOLUTION" == "1" || "$ALLOW_NEAR_RESOLUTION" == "true" ]]; then
  args+=(--allow-near-resolution)
fi

if [[ "$LOOP" == "1" || "$LOOP" == "true" ]]; then
  args+=(--loop)
fi

if [[ "$NOTIFY_TELEGRAM" == "1" || "$NOTIFY_TELEGRAM" == "true" ]]; then
  args+=(--notify-telegram)
fi

if [[ -n "$TELEGRAM_BOT_TOKEN" ]]; then
  args+=(--telegram-bot-token "$TELEGRAM_BOT_TOKEN")
fi

if [[ -n "$TELEGRAM_CHAT_ID" ]]; then
  args+=(--telegram-chat-id "$TELEGRAM_CHAT_ID")
fi

exec "$PY_BIN" "${args[@]}"
