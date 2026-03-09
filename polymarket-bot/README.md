# polymarket-bot

Autonomous pipeline skeleton with strict role separation:

- Ironclaw: fetch + sentiment only, writes only to `./exchange/snapshots` and `./exchange/reports`
- ClawX: strategy + risk + execution, reads snapshots and writes `./exchange/signals/latest_signal.json`
- Codex: orchestration, audit logs, config, and docs

## Directory Layout

- `config/`
- `exchange/snapshots/`
- `exchange/reports/`
- `exchange/signals/`
- `logs/`
- `state/`
- `scripts/`

## Data Contracts

### Snapshot Contract (`exchange/snapshots/*.json`)

Top-level fields:
- `as_of` (string, RFC3339 UTC timestamp)
- `source` (string, e.g. `ironclaw` / `ironclaw_mock`)
- `markets` (array)

Per market:
- `market_id` (string)
- `yes_price` (number in [0,1])
- `no_price` (number in [0,1], expected `1-yes_price`)
- `prev_yes_price` (number in [0,1])
- `sentiment` (object)
- `sentiment.score` (number in [0,1])
- `sentiment.label` (string)
- `sentiment.source` (string)

### Signal Contract (`exchange/signals/latest_signal.json`)

Top-level fields:
- `as_of` (string, RFC3339 UTC)
- `source_snapshot` (string path)
- `strategy` (string)
- `signals` (array)
- `summary` (object)

Per signal:
- `market_id` (string)
- `action` (`BUY_YES` or `HOLD`)
- `yes_price` (number)
- `no_price` (number)
- `price_delta_yes` (number)
- `sentiment_score` (number)
- `edge` (number)
- `reason` (string)

Rule used in mock fallback:
- if `price_delta_yes > 0.05` and `sentiment_score > 0.6` => `BUY_YES`
- else => `HOLD`

## Production Interfaces

### Step1 (Ironclaw)

`scripts/step1_ironclaw_fetch.sh` live mode order:

1. If `IRONCLAW_FETCH_CMD` is set, executes it via `bash -lc`.
2. Otherwise executes:
   - `${IRONCLAW_CMD:-ironclaw} fetch --markets <config/markets.yaml> --out <snapshot_out> --report <report_out>`

Exported env vars for custom command:
- `IRONCLAW_MARKETS_CFG`
- `IRONCLAW_SNAPSHOT_OUT`
- `IRONCLAW_REPORT_OUT`

### Step2 (ClawX signal)

`scripts/step2_clawx_signal.sh` live mode order:

1. If `CLAWX_SIGNAL_CMD` is set, executes it via `bash -lc`.
2. Otherwise executes:
   - `${CLAWX_CMD:-clawx} signal --snapshot <latest_snapshot.json> --risk <config/risk.yaml> --out <signal_out>`

Exported env vars for custom command:
- `CLAWX_SNAPSHOT_IN`
- `CLAWX_RISK_CFG`
- `CLAWX_SIGNAL_OUT`

### Step3 (ClawX execute)

`scripts/step3_clawx_execute.sh` live mode order:

1. If `CLAWX_EXEC_CMD` is set, executes it via `bash -lc`.
2. Otherwise executes:
   - `${CLAWX_CMD:-clawx} execute --signal <latest_signal.json> --risk <config/risk.yaml> --out <execution_log.json> --dry-run <true|false>`

Exported env vars for custom command:
- `CLAWX_SIGNAL_IN`
- `CLAWX_RISK_CFG`
- `CLAWX_EXEC_OUT`
- `CLAWX_DRY_RUN`

## One-Click Run

```bash
cd polymarket-bot
chmod +x scripts/*.sh
./scripts/run_pipeline.sh
```

Output locations:
- snapshots: `exchange/snapshots/`
- reports: `exchange/reports/`
- latest signal: `exchange/signals/latest_signal.json`
- execution logs: `logs/execution*.json` and `logs/execution.log`
- run summary: `logs/run.log`

## Autotrade Background (Screen Off)

For macOS background autotrade:

```bash
cd polymarket-bot
./scripts/autotrade_start.sh
./scripts/autotrade_status.sh
./scripts/autotrade_stop.sh
```

`autotrade_start.sh` now defaults to strict keep-awake mode using `caffeinate -i -m -s`,
which prevents idle sleep (and prevents system sleep on AC power) while display can still sleep.

Important:
- If macOS has already entered real system sleep, local processes cannot continue running.
- To run through true machine sleep/hibernate windows, move execution to an always-on host (VPS/server).

To disable keep-awake mode:

```bash
AUTOTRADE_KEEP_AWAKE=0 ./scripts/autotrade_start.sh
```

## Sports Paper Follow (`@swisstony`)

Sports-only paper copy mode (no live orders) with default simulated bankroll `1000` USDC:

```bash
cd polymarket-bot
./scripts/live/paper_follow_sports_local.sh
```

Background run:

```bash
cd polymarket-bot
./scripts/paper_follow_start.sh
./scripts/paper_follow_status.sh
./scripts/paper_follow_stop.sh
```

Recommended persistent scheduling (`launchd`, macOS):

```bash
cd polymarket-bot
./scripts/paper_follow_launchd_install.sh
./scripts/paper_follow_launchd_status.sh
./scripts/paper_follow_launchd_remove.sh
```

Default outputs:
- latest cycle: `logs/paper_follow_sports_latest.json`
- cycle history: `logs/paper_follow_sports_events.ndjson`
- state/book: `state/paper_follow_sports_state.json`

Optional env overrides in `.env`:
- `PAPER_FOLLOW_USERNAME` (default `swisstony`)
- `PAPER_FOLLOW_BANKROLL_USDC` (default `1000`)
- `PAPER_FOLLOW_INTERVAL_SECONDS` (default `45`)
- `PAPER_FOLLOW_LEADER_ADDRESS` (skip profile resolve)
- `PAPER_FOLLOW_NOTIFY_TELEGRAM` (`1` to enable push)
- `PAPER_FOLLOW_TELEGRAM_BOT_TOKEN`
- `PAPER_FOLLOW_TELEGRAM_CHAT_ID`
- `PAPER_FOLLOW_SCHEDULE` (`interval` or `hourly_on_the_hour`)
- `PAPER_FOLLOW_HOURLY_RUN_ON_START` (`1` means run once immediately, then every full hour)

## Mock Fallback

Production default is strict.

- `ALLOW_MOCK=false` (default): any missing live interface causes failure.
- `ALLOW_MOCK=true`: allows local mock fallback for step1/step2/step3.

## Security

- Never commit private keys.
- Private key is declared only as variable name in `.env.example`: `CLAWX_PRIVATE_KEY`.
- `CLAWX_PRIVATE_KEY` is only used by `scripts/step3_clawx_execute.sh`.
- Step1 (Ironclaw) and Step2 (ClawX signal) do not read private key.


## How To Fill `.env`

Fill these 3 lines first (already pre-filled with wrapper scripts):

- `IRONCLAW_FETCH_CMD='bash "/Users/xyu/Documents/New project/polymarket-bot/scripts/live/ironclaw_fetch_http.sh"'`
- `CLAWX_SIGNAL_CMD='bash "/Users/xyu/Documents/New project/polymarket-bot/scripts/live/clawx_signal_http.sh"'`
- `CLAWX_EXEC_CMD='bash "/Users/xyu/Documents/New project/polymarket-bot/scripts/live/clawx_execute_http.sh"'`

Then fill required runtime vars:

- `IRONCLAW_API_BASE` (example: `https://ironclaw.yourdomain.com/api`)
- `CLAWX_API_BASE` (example: `https://clawx.yourdomain.com/api`)
- `CLAWX_PRIVATE_KEY` (only used by step3)
- optional: `IRONCLAW_API_KEY`, `CLAWX_API_KEY`, `CLAWX_RPC_URL`

Expected HTTP endpoints for wrappers:

- `POST $IRONCLAW_API_BASE/fetch` => returns JSON with `snapshot` object and optional `report_markdown`
- `POST $CLAWX_API_BASE/signal` => returns JSON with `signal` object (or signal object directly)
- `POST $CLAWX_API_BASE/execute` => returns JSON with `execution` object (or execution object directly)


## Current Filled Commands

Your `.env` is already filled and runnable:

- `IRONCLAW_FETCH_CMD='bash "/Users/xyu/Documents/New project/polymarket-bot/scripts/live/ironclaw_fetch_local.sh"'`
- `CLAWX_SIGNAL_CMD='bash "/Users/xyu/Documents/New project/polymarket-bot/scripts/live/clawx_signal_local.sh"'`
- `CLAWX_EXEC_CMD='bash "/Users/xyu/Documents/New project/polymarket-bot/scripts/live/clawx_execute_local.sh"'`

This mode requires no external `IRONCLAW_API_BASE` / `CLAWX_API_BASE`.
It uses Polymarket Gamma directly in step1, deterministic local strategy in step2, and dry-run/local execution in step3.
