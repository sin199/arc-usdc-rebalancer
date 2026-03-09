#!/usr/bin/env bash
set -euo pipefail

# Inputs (from step2 script env):
#   CLAWX_SNAPSHOT_IN
#   CLAWX_RISK_CFG
#   CLAWX_SIGNAL_OUT
# Required env:
#   CLAWX_API_BASE      e.g. https://clawx.yourdomain.com/api
# Optional env:
#   CLAWX_API_KEY

: "${CLAWX_SNAPSHOT_IN:?missing CLAWX_SNAPSHOT_IN}"
: "${CLAWX_RISK_CFG:?missing CLAWX_RISK_CFG}"
: "${CLAWX_SIGNAL_OUT:?missing CLAWX_SIGNAL_OUT}"
: "${CLAWX_API_BASE:?missing CLAWX_API_BASE}"

AUTH_HEADER=()
if [[ -n "${CLAWX_API_KEY:-}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${CLAWX_API_KEY}")
fi

TMP_RESP="$(mktemp)"
trap 'rm -f "$TMP_RESP"' EXIT

curl -fsS -X POST "${CLAWX_API_BASE%/}/signal" \
  "${AUTH_HEADER[@]}" \
  -H "Content-Type: application/json" \
  --data-binary "$(python3 - <<'PY'
import json,os,pathlib
snap = json.loads(pathlib.Path(os.environ['CLAWX_SNAPSHOT_IN']).read_text(encoding='utf-8'))
risk = pathlib.Path(os.environ['CLAWX_RISK_CFG']).read_text(encoding='utf-8')
print(json.dumps({"snapshot": snap, "risk_yaml": risk}, ensure_ascii=True))
PY
)" \
  > "$TMP_RESP"

python3 - "$TMP_RESP" "$CLAWX_SIGNAL_OUT" <<'PY'
import json
import pathlib
import sys

resp = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
signal = resp.get('signal', resp)
if not isinstance(signal, dict):
    raise SystemExit('clawx signal response must be object')
out_path = pathlib.Path(sys.argv[2])
out_path.write_text(json.dumps(signal, ensure_ascii=True, indent=2), encoding='utf-8')
PY

echo "[live] clawx http signal ok"
