# Findings — Polymarket Autonomous Bot v4

## Source Document
- `/Users/xyu/Downloads/polymarket_master.html`

## Extracted Architecture
- 8 modules: StateStore, RiskGuard, NewsFilter, ShadowBook, InventoryAuditor, ExecutionEngine, FSM_Brain, Infra (WS/Alerter/Health/Watchdog).
- Event-driven async runtime with per-market FSM tasks.
- Validation order in FSM: market-state -> implied probs -> fair probs -> edge -> execution filters -> risk model.

## Strategy Rules (implemented)
- `MAKER_TRAP`: spread-based maker entry, timeout auto-cancel.
- `EVENT_SQUEEZE`: near-expiry event trading with news-required filter.
- `REVERSAL`: sharp-drop mean reversion with news-absent filter.

## Risk Rules (implemented)
- Market state guard (`active`, `closed`, `accepting_orders`) before execution.
- Probability normalization + sum check within epsilon.
- `edge >= 0.02`, `confidence >= 0.55`, liquidity threshold.
- Freeze / near-resolution guard (default block under 5 minutes).
- Kelly sizing with `0.25` fraction, hard cap `3%` bankroll per market.
- Daily drawdown stop at `10%`.
- No trade if recent execution failure rate `>20%`.
- No trade if bankroll volatility exceeds tolerance.

## Integration Decisions
- Isolated implementation under `polymarket-bot/autonomous_v4/`.
- Existing `scripts/` pipeline remains untouched.
- Exchange actions wrapped in async client adapter to allow SDK swap-in.
- Added snapshot file feed fallback for dry-run/quick validation.
