#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

exec /bin/bash "$ROOT_DIR/scripts/live_follow_consume_loop.sh"
