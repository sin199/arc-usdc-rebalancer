#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SNAP_DIR="$ROOT_DIR/exchange/snapshots"
REPORT_DIR="$ROOT_DIR/exchange/reports"
MARKETS_CFG="$ROOT_DIR/config/markets.yaml"
ENV_FILE="$ROOT_DIR/.env"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

ALLOW_MOCK_LC="$(printf '%s' "${ALLOW_MOCK:-false}" | tr '[:upper:]' '[:lower:]')"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
SNAP_FILE="$SNAP_DIR/snapshot_${STAMP}.json"
LATEST_FILE="$SNAP_DIR/latest_snapshot.json"
REPORT_FILE="$REPORT_DIR/ironclaw_${STAMP}.md"

mkdir -p "$SNAP_DIR" "$REPORT_DIR"

validate_snapshot() {
  local file="$1"
  python3 - "$file" <<'PY'
import json
import pathlib
import sys

p = pathlib.Path(sys.argv[1])
if not p.exists():
    raise SystemExit("snapshot file not found")
obj = json.loads(p.read_text(encoding="utf-8"))
for key in ["as_of", "markets"]:
    if key not in obj:
        raise SystemExit(f"snapshot missing field: {key}")
if not isinstance(obj["markets"], list):
    raise SystemExit("snapshot.markets must be list")
for row in obj["markets"]:
    for k in ["market_id", "yes_price", "no_price", "sentiment"]:
        if k not in row:
            raise SystemExit(f"snapshot.market missing field: {k}")
    s = row["sentiment"]
    if not isinstance(s, dict) or "score" not in s:
        raise SystemExit("snapshot.sentiment.score missing")
print("ok")
PY
}

run_ironclaw_live() {
  export IRONCLAW_MARKETS_CFG="$MARKETS_CFG"
  export IRONCLAW_SNAPSHOT_OUT="$SNAP_FILE"
  export IRONCLAW_REPORT_OUT="$REPORT_FILE"

  if [[ -n "${IRONCLAW_FETCH_CMD:-}" ]]; then
    bash -lc "$IRONCLAW_FETCH_CMD" || return 1
  else
    local bin="${IRONCLAW_CMD:-ironclaw}"
    command -v "$bin" >/dev/null 2>&1 || return 1
    "$bin" --help 2>/dev/null | grep -qE '^[[:space:]]+fetch([[:space:]]|$)' || return 1
    "$bin" fetch \
      --markets "$MARKETS_CFG" \
      --out "$SNAP_FILE" \
      --report "$REPORT_FILE" || return 1
  fi

  validate_snapshot "$SNAP_FILE" >/dev/null || return 1
  cp "$SNAP_FILE" "$LATEST_FILE" || return 1
  echo "[step1] ironclaw live snapshot -> $SNAP_FILE"
  echo "[step1] ironclaw report -> $REPORT_FILE"
}

run_mock() {
  python3 - "$MARKETS_CFG" "$SNAP_FILE" "$LATEST_FILE" "$NOW_ISO" <<'PY'
import json
import pathlib
import re
import sys

markets_cfg = pathlib.Path(sys.argv[1])
out_file = pathlib.Path(sys.argv[2])
latest_file = pathlib.Path(sys.argv[3])
as_of = sys.argv[4]

text = markets_cfg.read_text(encoding="utf-8")
market_ids = re.findall(r"market_id:\s*\"?([^\"\n]+)\"?", text)
if not market_ids:
    market_ids = ["mock-market-1", "mock-market-2"]

prev_map = {}
if latest_file.exists():
    try:
        prev = json.loads(latest_file.read_text(encoding="utf-8"))
        for row in prev.get("markets", []):
            mid = row.get("market_id")
            y = row.get("yes_price")
            if isinstance(mid, str) and isinstance(y, (int, float)):
                prev_map[mid] = float(y)
    except Exception:
        pass

sentiments = [0.72, 0.44, 0.63, 0.38]
deltas = [0.06, 0.01, -0.02, 0.03]
default_bases = [0.40, 0.51, 0.47, 0.55]

markets = []
for i, mid in enumerate(market_ids):
    base = prev_map.get(mid, default_bases[i % len(default_bases)])
    delta = deltas[i % len(deltas)]
    yes = max(0.01, min(0.99, base + delta))
    no = 1.0 - yes
    score = sentiments[i % len(sentiments)]
    markets.append({
        "market_id": mid,
        "yes_price": round(yes, 4),
        "no_price": round(no, 4),
        "prev_yes_price": round(base, 4),
        "sentiment": {
            "score": round(score, 4),
            "label": "bullish" if score > 0.6 else "neutral",
            "source": "ironclaw_mock"
        }
    })

snapshot = {
    "as_of": as_of,
    "source": "ironclaw_mock",
    "markets": markets
}

out_file.write_text(json.dumps(snapshot, ensure_ascii=True, indent=2), encoding="utf-8")
latest_file.write_text(json.dumps(snapshot, ensure_ascii=True, indent=2), encoding="utf-8")
print(str(out_file))
PY

cat > "$REPORT_FILE" <<EOF_RPT
# Ironclaw Fetch Report

- as_of: $NOW_ISO
- mode: mock
- snapshot: $(basename "$SNAP_FILE")
- notes: ALLOW_MOCK=true fallback path
EOF_RPT

  echo "[step1] ironclaw mock snapshot -> $SNAP_FILE"
  echo "[step1] ironclaw report -> $REPORT_FILE"
}

if run_ironclaw_live; then
  exit 0
fi

if [[ "$ALLOW_MOCK_LC" == "true" ]]; then
  echo "[step1] live ironclaw unavailable, fallback to mock because ALLOW_MOCK=true"
  run_mock
  exit 0
fi

echo "[step1] production fetch failed and ALLOW_MOCK is not true" >&2
echo "[step1] set IRONCLAW_CMD/IRONCLAW_FETCH_CMD or set ALLOW_MOCK=true for fallback" >&2
exit 1
