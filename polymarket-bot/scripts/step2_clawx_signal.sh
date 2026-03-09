#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="$ROOT_DIR/.env"
SNAP_FILE="$ROOT_DIR/exchange/snapshots/latest_snapshot.json"
RISK_CFG="$ROOT_DIR/config/risk.yaml"
SIG_DIR="$ROOT_DIR/exchange/signals"
mkdir -p "$SIG_DIR"

if [[ -f "$ENV_FILE" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

ALLOW_MOCK_LC="$(printf '%s' "${ALLOW_MOCK:-false}" | tr '[:upper:]' '[:lower:]')"

if [[ ! -f "$SNAP_FILE" ]]; then
  echo "[step2] missing snapshot: $SNAP_FILE" >&2
  exit 1
fi

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_FILE="$SIG_DIR/signal_${STAMP}.json"
LATEST_FILE="$SIG_DIR/latest_signal.json"

validate_signal() {
  local file="$1"
  python3 - "$file" <<'PY'
import json
import pathlib
import sys

p = pathlib.Path(sys.argv[1])
if not p.exists():
    raise SystemExit("signal file not found")
obj = json.loads(p.read_text(encoding="utf-8"))
for k in ["as_of", "strategy", "signals", "summary"]:
    if k not in obj:
        raise SystemExit(f"signal missing field: {k}")
if not isinstance(obj["signals"], list):
    raise SystemExit("signal.signals must be list")
for row in obj["signals"]:
    for key in ["market_id", "action", "yes_price", "no_price", "sentiment_score"]:
        if key not in row:
            raise SystemExit(f"signal row missing field: {key}")
print("ok")
PY
}

run_clawx_live() {
  export CLAWX_SNAPSHOT_IN="$SNAP_FILE"
  export CLAWX_RISK_CFG="$RISK_CFG"
  export CLAWX_SIGNAL_OUT="$OUT_FILE"

  if [[ -n "${CLAWX_SIGNAL_CMD:-}" ]]; then
    bash -lc "$CLAWX_SIGNAL_CMD" || return 1
  else
    local bin="${CLAWX_CMD:-clawx}"
    command -v "$bin" >/dev/null 2>&1 || return 1
    "$bin" signal \
      --snapshot "$SNAP_FILE" \
      --risk "$RISK_CFG" \
      --out "$OUT_FILE" || return 1
  fi

  validate_signal "$OUT_FILE" >/dev/null || return 1
  cp "$OUT_FILE" "$LATEST_FILE" || return 1
  echo "[step2] clawx live signal -> $OUT_FILE"
  echo "[step2] latest signal -> $LATEST_FILE"
}

run_mock() {
  python3 - "$SNAP_FILE" "$OUT_FILE" "$LATEST_FILE" <<'PY'
import json
import pathlib
import sys

snap_path = pathlib.Path(sys.argv[1])
out_path = pathlib.Path(sys.argv[2])
latest_path = pathlib.Path(sys.argv[3])

snap = json.loads(snap_path.read_text(encoding="utf-8"))
as_of = snap.get("as_of")
markets = snap.get("markets", [])

signals = []
buy_count = 0
hold_count = 0

for row in markets:
    market_id = row.get("market_id", "")
    yes = float(row.get("yes_price", 0.5))
    no = float(row.get("no_price", 0.5))
    prev_yes = float(row.get("prev_yes_price", yes))
    score = float((row.get("sentiment") or {}).get("score", 0.5))

    delta = yes - prev_yes
    edge = max(0.0, delta * score)

    if delta > 0.05 and score > 0.6:
        action = "BUY_YES"
        reason = "price_delta_yes>0.05 and sentiment_score>0.6"
        buy_count += 1
    else:
        action = "HOLD"
        reason = "entry_condition_not_met"
        hold_count += 1

    signals.append({
        "market_id": market_id,
        "action": action,
        "yes_price": round(yes, 4),
        "no_price": round(no, 4),
        "price_delta_yes": round(delta, 4),
        "sentiment_score": round(score, 4),
        "edge": round(edge, 6),
        "reason": reason
    })

signal = {
    "as_of": as_of,
    "source_snapshot": str(snap_path),
    "strategy": "simple_momentum_sentiment_v1",
    "signals": signals,
    "summary": {
        "buy_yes_count": buy_count,
        "hold_count": hold_count,
        "total": len(signals)
    }
}

payload = json.dumps(signal, ensure_ascii=True, indent=2)
out_path.write_text(payload, encoding="utf-8")
latest_path.write_text(payload, encoding="utf-8")
print(str(out_path))
PY

  echo "[step2] clawx mock signal -> $OUT_FILE"
  echo "[step2] latest signal -> $LATEST_FILE"
}

if run_clawx_live; then
  exit 0
fi

if [[ "$ALLOW_MOCK_LC" == "true" ]]; then
  echo "[step2] live clawx signal unavailable, fallback to mock because ALLOW_MOCK=true"
  run_mock
  exit 0
fi

echo "[step2] production signal failed and ALLOW_MOCK is not true" >&2
echo "[step2] set CLAWX_CMD/CLAWX_SIGNAL_CMD or set ALLOW_MOCK=true for fallback" >&2
exit 1
