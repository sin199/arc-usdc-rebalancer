#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

cd "$ROOT_DIR"
# single cycle, real market data + paper simulation + telegram push
PAPER_FOLLOW_LOOP=0 "$ROOT_DIR/scripts/live/paper_follow_sports_local.sh" >> "$LOG_DIR/paper_follow.log" 2>&1
