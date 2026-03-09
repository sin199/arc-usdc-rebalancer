#!/usr/bin/env bash
set -euo pipefail

# Inputs (from step1 script env):
#   IRONCLAW_MARKETS_CFG
#   IRONCLAW_SNAPSHOT_OUT
#   IRONCLAW_REPORT_OUT
# Required env:
#   IRONCLAW_API_BASE   e.g. https://ironclaw.yourdomain.com/api
# Optional env:
#   IRONCLAW_API_KEY

: "${IRONCLAW_MARKETS_CFG:?missing IRONCLAW_MARKETS_CFG}"
: "${IRONCLAW_SNAPSHOT_OUT:?missing IRONCLAW_SNAPSHOT_OUT}"
: "${IRONCLAW_REPORT_OUT:?missing IRONCLAW_REPORT_OUT}"
: "${IRONCLAW_API_BASE:?missing IRONCLAW_API_BASE}"

AUTH_HEADER=()
if [[ -n "${IRONCLAW_API_KEY:-}" ]]; then
  AUTH_HEADER=(-H "Authorization: Bearer ${IRONCLAW_API_KEY}")
fi

TMP_RESP="$(mktemp)"
trap 'rm -f "$TMP_RESP"' EXIT

curl -fsS -X POST "${IRONCLAW_API_BASE%/}/fetch" \
  "${AUTH_HEADER[@]}" \
  -H "Content-Type: application/json" \
  --data-binary "$(python3 - <<'PY'
import json,os,pathlib
cfg = pathlib.Path(os.environ['IRONCLAW_MARKETS_CFG'])
obj = {"markets_config": cfg.read_text(encoding='utf-8')}
print(json.dumps(obj, ensure_ascii=True))
PY
)" \
  > "$TMP_RESP"

python3 - "$TMP_RESP" "$IRONCLAW_SNAPSHOT_OUT" "$IRONCLAW_REPORT_OUT" <<'PY'
import json
import pathlib
import sys

resp = json.loads(pathlib.Path(sys.argv[1]).read_text(encoding='utf-8'))
snapshot = resp.get('snapshot')
if not isinstance(snapshot, dict):
    raise SystemExit('ironclaw response missing snapshot object')

out_snapshot = pathlib.Path(sys.argv[2])
out_snapshot.write_text(json.dumps(snapshot, ensure_ascii=True, indent=2), encoding='utf-8')

report = resp.get('report_markdown', '# Ironclaw Report\n\nNo report content returned.')
out_report = pathlib.Path(sys.argv[3])
out_report.write_text(str(report), encoding='utf-8')
PY

echo "[live] ironclaw http fetch ok"
