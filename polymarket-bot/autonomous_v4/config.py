from __future__ import annotations

from dataclasses import dataclass

# Hard constraints
EPSILON = 1e-6
RESERVED_CAPITAL = 20.0
MAKER_FEE_RATE = 0.0
TAKER_FEE_RATE = 0.02
ESTIMATED_GAS_USDC = 0.01

# Decision filters
EDGE_THRESHOLD = 0.02
CONFIDENCE_THRESHOLD = 0.55
MIN_LIQUIDITY_USDC = 10_000.0
MIN_RESOLUTION_SECONDS = 300
ALLOW_NEAR_RESOLUTION_TRADES = False
FREEZE_GUARD_ENABLED = True

# Risk controls
KELLY_FRACTION = 0.25
MAX_POSITION_BANKROLL_FRACTION = 0.03
DAILY_DRAWDOWN_STOP_PCT = 0.10
EXECUTION_FAILURE_RATE_LIMIT = 0.20
BANKROLL_VOLATILITY_TOLERANCE = 0.20
MIN_ORDER_SIZE_USDC = 0.5
MAX_TRADES_PER_DAY = 5

# FSM / runtime
MARKET_LOOP_SECONDS = 30
WATCH_MODE_SLEEP_SECONDS = 300
HOLDING_CHECK_SECONDS = 5
NEWS_WINDOW_MINUTES = 30
NEWS_CACHE_SECONDS = 300


@dataclass(frozen=True)
class StrategyRule:
    stop_loss_pct: float
    take_profit_pct: float
    max_size_usdc: float
    requires_news: bool = False
    requires_no_news: bool = False
    is_maker: bool = False


STRATEGY_RULES = {
    "MAKER_TRAP": StrategyRule(
        stop_loss_pct=0.0,
        take_profit_pct=0.0,
        max_size_usdc=12.0,
        is_maker=True,
    ),
    "EVENT_SQUEEZE": StrategyRule(
        stop_loss_pct=0.30,
        take_profit_pct=0.40,
        max_size_usdc=12.0,
        requires_news=True,
    ),
    "REVERSAL": StrategyRule(
        stop_loss_pct=0.20,
        take_profit_pct=0.08,
        max_size_usdc=8.0,
        requires_no_news=True,
    ),
}

MODE_THRESHOLDS = {
    "FULL": 60.0,
    "REDUCED": 30.0,
    "LEAN": 10.0,
    "MICRO": 0.5,
}

MODE_MAX_SIZE = {
    "FULL": 12.0,
    "REDUCED": 6.0,
    "LEAN": 4.0,
    "MICRO": 1.0,
    "WATCH": 0.0,
}

STRATEGY_ALLOWED = {
    "FULL": {"MAKER_TRAP", "EVENT_SQUEEZE", "REVERSAL"},
    "REDUCED": {"MAKER_TRAP", "EVENT_SQUEEZE"},
    "LEAN": {"MAKER_TRAP"},
    "MICRO": {"MAKER_TRAP"},
    "WATCH": set(),
}
