# Task Plan — Polymarket Autonomous Bot v4

## Goal
Build a runnable autonomous Polymarket trading bot implementation based on `/Users/xyu/Downloads/polymarket_master.html`, with strict risk-first evaluation flow and machine-readable decision outputs.

## Constraints
- Follow the 8-module architecture from the provided master document.
- Preserve capital-first controls and deterministic decision logic.
- Use async I/O (aiohttp/websockets/aiosqlite), no blocking calls in strategy loop.
- Keep implementation isolated from existing script-based pipeline.

## Phases
| Phase | Status | Notes |
|---|---|---|
| 1. Context extraction and design mapping | complete | Parsed HTML sections and extracted module requirements |
| 2. Project scaffolding + core models/config | complete | Created `autonomous_v4` package and constants/models |
| 3. Risk/state modules | complete | Implemented `infra/state_store.py` and `risk_guard.py` |
| 4. Data modules | complete | Implemented `news_filter.py` and `shadow_book.py` |
| 5. Execution modules | complete | Implemented `inventory_auditor.py` and `execution_engine.py` |
| 6. FSM + orchestration | complete | Implemented `fsm_brain.py` + strict validation sequence |
| 7. Infra + deployment files | complete | Implemented ws/alerter/health/watchdog + Docker assets |
| 8. Validation + handoff | complete | compile + dry-run smoke test succeeded |

## Errors Encountered
| Error | Attempt | Resolution |
|---|---|---|
| `ModuleNotFoundError: yaml` in smoke run | 1 | Created local venv `autonomous_v4/.venv` and installed requirements |
| PEP 668 blocked global pip install | 1 | Switched to project-local venv install |
| Watchdog false positives in snapshot feed mode | 1 | Dynamic stale threshold + exclude inventory when user WS not configured |
