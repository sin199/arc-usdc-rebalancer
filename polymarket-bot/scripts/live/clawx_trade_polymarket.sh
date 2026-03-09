#!/usr/bin/env bash
set -euo pipefail

: "${ORDER_MARKET_ID:?missing ORDER_MARKET_ID}"
: "${ORDER_SIDE:?missing ORDER_SIDE}"
: "${ORDER_SIZE_USDC:?missing ORDER_SIZE_USDC}"
: "${CLAWX_PRIVATE_KEY:?missing CLAWX_PRIVATE_KEY}"

POLY_ROOT="${CLAWX_POLYMARKET_ROOT:-/Users/xyu/Projects/polymarket_bot}"
POLY_ENV="$POLY_ROOT/.env"
POLY_SCRIPT="$POLY_ROOT/execute_market_order.py"
POLY_PY="${CLAWX_POLYMARKET_PYTHON:-$POLY_ROOT/.venv/bin/python}"
GAMMA_BASE="${IRONCLAW_GAMMA_BASE:-https://gamma-api.polymarket.com}"

if [[ ! -x "$POLY_PY" ]]; then
  echo "missing python interpreter: $POLY_PY" >&2
  exit 1
fi
if [[ ! -f "$POLY_SCRIPT" ]]; then
  echo "missing execute script: $POLY_SCRIPT" >&2
  exit 1
fi

if [[ -f "$POLY_ENV" ]]; then
  set -a
  # shellcheck disable=SC1090
  source "$POLY_ENV"
  set +a
fi

export POLYMARKET_PRIVATE_KEY="$CLAWX_PRIVATE_KEY"
export POLYMARKET_HOST="${POLYMARKET_HOST:-https://clob.polymarket.com}"
export POLYMARKET_CHAIN_ID="${POLYMARKET_CHAIN_ID:-137}"
export POLYMARKET_SIGNATURE_TYPE="${POLYMARKET_SIGNATURE_TYPE:-2}"

if [[ -z "${POLYMARKET_FUNDER:-}" ]]; then
  echo "missing POLYMARKET_FUNDER (required for signature_type=${POLYMARKET_SIGNATURE_TYPE})" >&2
  exit 1
fi

ORDER_OUTCOME_INDEX="${ORDER_OUTCOME_INDEX:-}"
ORDER_LIMIT_PRICE="${ORDER_LIMIT_PRICE:-}"

read -r TOKEN_ID LIMIT_PRICE OUTCOME_LABEL < <(
  python3 - "$ORDER_MARKET_ID" "$ORDER_SIDE" "$GAMMA_BASE" "$ORDER_OUTCOME_INDEX" "$ORDER_LIMIT_PRICE" <<'PY'
import json
import sys
import urllib.error
import urllib.parse
import urllib.request

slug = sys.argv[1].strip()
side = sys.argv[2].strip().upper()
gamma_base = sys.argv[3].rstrip("/")
idx_override_raw = sys.argv[4].strip() if len(sys.argv) > 4 else ""
limit_override_raw = sys.argv[5].strip() if len(sys.argv) > 5 else ""

if not slug:
    raise SystemExit("empty ORDER_MARKET_ID")

url = f"{gamma_base}/markets/slug/{urllib.parse.quote(slug)}"
req = urllib.request.Request(url, headers={"User-Agent": "polymarket-bot/1.0"})
try:
    with urllib.request.urlopen(req, timeout=20) as resp:
        market = json.loads(resp.read().decode("utf-8"))
except urllib.error.HTTPError as e:
    raise SystemExit(f"gamma_http_error:{e.code}")
except Exception as e:
    raise SystemExit(f"gamma_fetch_failed:{e}")

if not bool(market.get("active")) or bool(market.get("closed")):
    raise SystemExit("market_not_tradable_state")
if not bool(market.get("acceptingOrders")):
    raise SystemExit("market_not_accepting_orders")

def parse_arr(v):
    if isinstance(v, list):
        return v
    if isinstance(v, str):
        try:
            return json.loads(v)
        except Exception:
            return [x.strip() for x in v.split(",") if x.strip()]
    return []

outcomes = parse_arr(market.get("outcomes"))
prices = parse_arr(market.get("outcomePrices"))
token_ids = parse_arr(market.get("clobTokenIds"))

if not outcomes or not prices or not token_ids:
    raise SystemExit("market_missing_outcomes_or_prices_or_tokens")
if not (len(outcomes) == len(prices) == len(token_ids)):
    raise SystemExit("market_array_length_mismatch")

norm = [str(x).strip().lower() for x in outcomes]
idx_yes = norm.index("yes") if "yes" in norm else 0
idx_no = norm.index("no") if "no" in norm else (1 if len(outcomes) > 1 else 0)

if idx_override_raw:
    try:
        idx = int(idx_override_raw)
    except Exception:
        idx = idx_yes
elif side == "BUY_NO":
    idx = idx_no
else:
    idx = idx_yes
idx = max(0, min(idx, len(outcomes) - 1))

token_id = str(token_ids[idx]).strip()
outcome_label = str(outcomes[idx]).strip() or "OUTCOME0"
if not token_id:
    raise SystemExit("empty_token_id")

if limit_override_raw:
    try:
        price = float(limit_override_raw)
    except Exception:
        price = 0.5
else:
    try:
        price = float(prices[idx])
    except Exception:
        price = 0.5

price = max(0.01, min(0.99, price))
print(f"{token_id} {price:.3f} {outcome_label.replace(' ', '_')}")
PY
)

AMOUNT_USD="$(python3 - "$ORDER_SIZE_USDC" <<'PY'
import sys
v = float(sys.argv[1])
if v < 1.0:
    v = 1.0
print(f"{v:.2f}")
PY
)"

"$POLY_PY" "$POLY_SCRIPT" buy_limit \
  --token-id "$TOKEN_ID" \
  --amount-usd "$AMOUNT_USD" \
  --max-price "$LIMIT_PRICE"
