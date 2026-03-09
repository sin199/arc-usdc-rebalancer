#!/usr/bin/env bash
set -euo pipefail

SOURCE_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SOURCE_STATE_DIR="$SOURCE_ROOT/state"
SOURCE_LOG_DIR="$SOURCE_ROOT/logs"
ENV_FILE="$SOURCE_ROOT/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

STAGE_BASE_DEFAULT="$HOME/Library/Application Support/com.xyu.polymarket.livefollow"
STAGE_BASE="${LIVE_FOLLOW_STAGE_BASE:-$STAGE_BASE_DEFAULT}"
STAGE_ROOT="${LIVE_FOLLOW_STAGE_ROOT:-$STAGE_BASE/runtime/polymarket-bot}"
MARKER_FILE="$SOURCE_STATE_DIR/live_follow_runtime_root.txt"
PRINT_ROOT_ONLY=0

if [[ "${1:-}" == "--print-root" ]]; then
  PRINT_ROOT_ONLY=1
fi

mkdir -p "$STAGE_BASE" "$SOURCE_STATE_DIR"
seed_runtime_data=0
if [[ ! -d "$STAGE_ROOT/state" || ! -d "$STAGE_ROOT/logs" ]]; then
  seed_runtime_data=1
fi

if ! command -v rsync >/dev/null 2>&1; then
  echo "missing rsync for live follow staging" >&2
  exit 1
fi

mkdir -p "$STAGE_ROOT"

rsync -a --delete \
  --exclude '.git/' \
  --exclude '.DS_Store' \
  --exclude 'logs/' \
  --exclude 'state/' \
  --exclude 'tmp/' \
  --exclude '__pycache__/' \
  --exclude 'autonomous_v4/' \
  --exclude 'exchange/' \
  "$SOURCE_ROOT/" "$STAGE_ROOT/"

mkdir -p "$STAGE_ROOT/logs" "$STAGE_ROOT/state"
if (( seed_runtime_data )); then
  rsync -a "$SOURCE_STATE_DIR/" "$STAGE_ROOT/state/"
  rsync -a "$SOURCE_LOG_DIR/" "$STAGE_ROOT/logs/"
fi
find "$STAGE_ROOT/scripts" -type f -name '*.sh' -exec chmod +x {} +

printf '%s\n' "$STAGE_ROOT" > "$MARKER_FILE"
printf '%s\n' "$STAGE_ROOT" > "$STAGE_ROOT/state/live_follow_runtime_root.txt"

if (( PRINT_ROOT_ONLY )); then
  printf '%s\n' "$STAGE_ROOT"
  exit 0
fi

echo "live_follow runtime staged source_root=$SOURCE_ROOT stage_root=$STAGE_ROOT seed_runtime_data=$seed_runtime_data"
