#!/usr/bin/env bash
set -euo pipefail

: "${CLAWX_SNAPSHOT_IN:?missing CLAWX_SNAPSHOT_IN}"
: "${CLAWX_RISK_CFG:?missing CLAWX_RISK_CFG}"
: "${CLAWX_SIGNAL_OUT:?missing CLAWX_SIGNAL_OUT}"

python3 - "$CLAWX_SNAPSHOT_IN" "$CLAWX_SIGNAL_OUT" <<'PY'
import json
import pathlib
import sys

snap_path = pathlib.Path(sys.argv[1])
out_path = pathlib.Path(sys.argv[2])

snap = json.loads(snap_path.read_text(encoding='utf-8'))
rows = snap.get('markets', [])

signals = []
buy = hold = 0
for r in rows:
    market_id = str(r.get('market_id',''))
    yes = float(r.get('yes_price', 0.5))
    no = float(r.get('no_price', 0.5))
    prev_yes = float(r.get('prev_yes_price', yes))
    score = float((r.get('sentiment') or {}).get('score', 0.5))

    delta = yes - prev_yes
    edge = max(0.0, delta)

    if delta > 0.05 and score > 0.6:
        action = 'BUY_YES'
        reason = 'price_delta_yes>0.05 and sentiment>0.6'
        buy += 1
    else:
        action = 'HOLD'
        reason = 'entry_condition_not_met'
        hold += 1

    signals.append({
        'market_id': market_id,
        'action': action,
        'yes_price': round(yes,4),
        'no_price': round(no,4),
        'price_delta_yes': round(delta,4),
        'sentiment_score': round(score,4),
        'edge': round(edge,6),
        'reason': reason,
    })

payload = {
    'as_of': snap.get('as_of'),
    'source_snapshot': str(snap_path),
    'strategy': 'clawx_local_momentum_sentiment_v1',
    'signals': signals,
    'summary': {'buy_yes_count': buy, 'hold_count': hold, 'total': len(signals)},
}
out_path.write_text(json.dumps(payload, ensure_ascii=True, indent=2), encoding='utf-8')
print(str(out_path))
PY

echo "[live] clawx local signal ok"
