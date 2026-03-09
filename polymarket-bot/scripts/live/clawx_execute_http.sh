#!/usr/bin/env bash
set -euo pipefail

# Inputs (from step3 script env):
#   CLAWX_SIGNAL_IN
#   CLAWX_RISK_CFG
#   CLAWX_EXEC_OUT
#   CLAWX_DRY_RUN
# Required env:
#   CLAWX_API_BASE
#   CLAWX_PRIVATE_KEY
# Optional env:
#   CLAWX_API_KEY
#   CLAWX_RPC_URL

: "${CLAWX_SIGNAL_IN:?missing CLAWX_SIGNAL_IN}"
: "${CLAWX_RISK_CFG:?missing CLAWX_RISK_CFG}"
: "${CLAWX_EXEC_OUT:?missing CLAWX_EXEC_OUT}"
: "${CLAWX_DRY_RUN:?missing CLAWX_DRY_RUN}"
: "${CLAWX_API_BASE:?missing CLAWX_API_BASE}"
: "${CLAWX_PRIVATE_KEY:?missing CLAWX_PRIVATE_KEY}"

AUTH_HEADER=()
if [[ -n "${CLAWX_API_KEY:-}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${CLAWX_API_KEY}")
fi

TMP_RESP="$(mktemp)"
trap 'rm -f "$TMP_RESP"' EXIT

curl -fsS -X POST "${CLAWX_API_BASE%/}/execute" \
  "${AUTH_HEADER[@]}" \
  -H "Content-Type: application/json" \
  --data-binary "$(python3 - <<'PY'
import json,os,pathlib
signal = json.loads(pathlib.Path(os.environ['CLAWX_SIGNAL_IN']).read_text(encoding='utf-8'))
risk = pathlib.Path(os.environ['CLAWX_RISK_CFG']).read_text(encoding='utf-8')
obj = {
    "signal": signal,
    "risk_yaml": risk,
    "dry_run": os.environ['CLAWX_DRY_RUN'].lower() == 'true',
    "private_key": os.environ['CLAWX_PRIVATE_KEY'],
    "rpc_url": os.environ.get('CLAWX_RPC_URL', '')
}
print(json.dumps(obj, ensure_ascii=True))
PY
)" \
  > "$TMP_RESP"

python3 - "$TMP_RESP" "$CLAWX_EXEC_OUT" <<'PY'
import json
import pathlib
import sys

resp = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
execution = resp.get('execution', resp)
if not isinstance(execution, dict):
    raise SystemExit('clawx execute response must be object')
out_path = pathlib.Path(sys.argv[2])
out_path.write_text(json.dumps(execution, ensure_ascii=True, indent=2), encoding='utf-8')
PY

echo "[live] clawx http execute ok"
