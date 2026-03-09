from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
from enum import Enum
from typing import Any, Optional


class Strategy(str, Enum):
    MAKER_TRAP = "MAKER_TRAP"
    EVENT_SQUEEZE = "EVENT_SQUEEZE"
    REVERSAL = "REVERSAL"


class Decision(str, Enum):
    BUY = "BUY"
    SELL = "SELL"
    WAIT = "WAIT"


class RiskLevel(str, Enum):
    LOW = "LOW"
    MEDIUM = "MEDIUM"
    HIGH = "HIGH"


@dataclass(slots=True)
class MarketStatus:
    active: Optional[bool] = None
    closed: Optional[bool] = None
    accepting_orders: Optional[bool] = None
    freeze: bool = False
    resolution_ts: Optional[float] = None


@dataclass(slots=True)
class MarketSnapshot:
    market_id: str
    market_slug: str
    yes_price: float
    no_price: float
    best_bid: float
    best_ask: float
    liquidity: float
    status: MarketStatus = field(default_factory=MarketStatus)
    updated_ts: float = field(default_factory=lambda: datetime.now(timezone.utc).timestamp())


@dataclass(slots=True)
class Signal:
    market_id: str
    market_slug: str
    strategy: Strategy
    side: str
    confidence: float
    prob: float
    odds: float
    gain: float
    loss: float
    keywords: list[str] = field(default_factory=list)


@dataclass(slots=True)
class Position:
    market_id: str
    market_slug: str
    side: str
    strategy: Strategy
    size: float
    entry_price: float
    entry_ts: float
    stop_loss_pct: float
    take_profit_pct: float


@dataclass(slots=True)
class MarketContext:
    snapshot: MarketSnapshot
    implied_probs: list[float] = field(default_factory=list)
    fair_probs: list[float] = field(default_factory=list)
    edge: list[float] = field(default_factory=list)
    decision: Decision = Decision.WAIT
    confidence: float = 0.0
    risk_level: RiskLevel = RiskLevel.HIGH
    recommended_size_fraction: float = 0.0
    approved_size: float = 0.0
    strategy: Strategy = Strategy.MAKER_TRAP
    side: str = "YES"
    reason_codes: list[str] = field(default_factory=list)


@dataclass(slots=True)
class DecisionOutput:
    market_slug: str
    timestamp_utc: str
    implied_probs: list[float]
    fair_probs: list[float]
    edge: list[float]
    decision: Decision
    confidence: float
    risk_level: RiskLevel
    recommended_size_fraction: float
    reason_codes: list[str]

    def to_dict(self) -> dict[str, Any]:
        payload = asdict(self)
        payload["decision"] = self.decision.value
        payload["risk_level"] = self.risk_level.value
        return payload


def utc_now_iso() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")
