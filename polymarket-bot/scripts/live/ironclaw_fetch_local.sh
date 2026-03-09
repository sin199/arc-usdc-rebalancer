#!/usr/bin/env bash
set -euo pipefail

: "${IRONCLAW_MARKETS_CFG:?missing IRONCLAW_MARKETS_CFG}"
: "${IRONCLAW_SNAPSHOT_OUT:?missing IRONCLAW_SNAPSHOT_OUT}"
: "${IRONCLAW_REPORT_OUT:?missing IRONCLAW_REPORT_OUT}"

GAMMA_BASE="${IRONCLAW_GAMMA_BASE:-https://gamma-api.polymarket.com}"
LATEST_SNAPSHOT="${IRONCLAW_LATEST_SNAPSHOT:-$(dirname "$IRONCLAW_SNAPSHOT_OUT")/latest_snapshot.json}"
NOW_ISO="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

python3 - "$IRONCLAW_MARKETS_CFG" "$IRONCLAW_SNAPSHOT_OUT" "$IRONCLAW_REPORT_OUT" "$GAMMA_BASE" "$LATEST_SNAPSHOT" "$NOW_ISO" <<'PY'
import json
import pathlib
import re
import sys
import urllib.request
import urllib.error

markets_cfg = pathlib.Path(sys.argv[1])
out_snapshot = pathlib.Path(sys.argv[2])
out_report = pathlib.Path(sys.argv[3])
gamma_base = sys.argv[4].rstrip('/')
latest_snapshot = pathlib.Path(sys.argv[5])
as_of = sys.argv[6]

text = markets_cfg.read_text(encoding='utf-8')
market_ids = re.findall(r'market_id:\s*"?([^"\n]+)"?', text)
if not market_ids:
    raise SystemExit('no market_id found in config/markets.yaml')

prev_yes = {}
if latest_snapshot.exists():
    try:
        p = json.loads(latest_snapshot.read_text(encoding='utf-8'))
        for r in p.get('markets', []):
            mid = r.get('market_id')
            y = r.get('yes_price')
            if isinstance(mid, str) and isinstance(y, (int, float)):
                prev_yes[mid] = float(y)
    except Exception:
        pass

positive = {'win','wins','beat','beats','rise','rises','above','bull','growth','approve','approved','yes'}
negative = {'lose','loses','drop','drops','below','bear','decline','reject','rejected','no'}

def sentiment_score(s: str) -> float:
    s = re.sub(r'[^a-zA-Z0-9 ]',' ', s.lower())
    toks = [t for t in s.split() if t]
    pos = sum(1 for t in toks if t in positive)
    neg = sum(1 for t in toks if t in negative)
    score = 0.5 + 0.06 * pos - 0.06 * neg
    return max(0.05, min(0.95, round(score, 4)))

def fetch_slug(slug: str):
    url = f"{gamma_base}/markets/slug/{slug}"
    req = urllib.request.Request(url, headers={'User-Agent':'polymarket-bot/1.0'})
    with urllib.request.urlopen(req, timeout=15) as r:
        return json.loads(r.read().decode('utf-8'))

markets = []
ok_count = 0
fallback_count = 0
errors = []

for mid in market_ids:
    yes = None
    no = None
    question = mid
    source = 'ironclaw_local'
    try:
        m = fetch_slug(mid)
        question = m.get('question') or question
        outcomes = m.get('outcomes')
        prices = m.get('outcomePrices')
        if isinstance(outcomes, str):
            try:
                outcomes = json.loads(outcomes)
            except Exception:
                outcomes = [x.strip() for x in outcomes.split(',') if x.strip()]
        if isinstance(prices, str):
            try:
                prices = json.loads(prices)
            except Exception:
                prices = [float(x.strip()) for x in prices.split(',') if x.strip()]
        if isinstance(outcomes, list) and isinstance(prices, list) and len(outcomes) == len(prices) and len(prices) >= 2:
            idx_yes = 0
            idx_no = 1
            norm = [str(x).strip().lower() for x in outcomes]
            if 'yes' in norm and 'no' in norm:
                idx_yes = norm.index('yes')
                idx_no = norm.index('no')
            yes = float(prices[idx_yes])
            no = float(prices[idx_no])
        ok_count += 1
    except Exception as e:
        fallback_count += 1
        errors.append(f"{mid}: {e}")

    prev = float(prev_yes.get(mid, 0.5))
    if yes is None:
        # Live fallback: carry forward last known price; do not inject random values.
        yes = prev
        no = 1.0 - yes
        source = 'ironclaw_local_fallback_prev'

    yes = max(0.01, min(0.99, float(yes)))
    no = max(0.01, min(0.99, float(no)))
    s = yes + no
    yes, no = yes/s, no/s

    score = sentiment_score(question)
    markets.append({
        'market_id': mid,
        'yes_price': round(yes, 4),
        'no_price': round(no, 4),
        'prev_yes_price': round(prev, 4),
        'sentiment': {
            'score': score,
            'label': 'bullish' if score > 0.6 else ('bearish' if score < 0.4 else 'neutral'),
            'source': source,
        }
    })

snapshot = {
    'as_of': as_of,
    'source': 'ironclaw_local',
    'markets': markets,
}
out_snapshot.write_text(json.dumps(snapshot, ensure_ascii=True, indent=2), encoding='utf-8')

report_lines = [
    '# Ironclaw Local Fetch Report',
    '',
    f'- as_of: {as_of}',
    f'- gamma_base: {gamma_base}',
    f'- requested_markets: {len(market_ids)}',
    f'- fetched_from_gamma: {ok_count}',
    f'- fallback_prev_used: {fallback_count}',
]
if errors:
    report_lines.append('- errors:')
    for e in errors[:20]:
        report_lines.append(f'  - {e}')
out_report.write_text('\n'.join(report_lines) + '\n', encoding='utf-8')

print(str(out_snapshot))
PY

echo "[live] ironclaw local fetch ok"
