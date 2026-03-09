#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="$ROOT_DIR/logs"
mkdir -p "$LOG_DIR"

cd "$ROOT_DIR"
"$ROOT_DIR/scripts/live/live_follow_sports_local.sh" >> "$LOG_DIR/live_follow.log" 2>&1
