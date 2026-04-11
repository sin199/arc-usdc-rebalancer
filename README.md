# Arc Treasury Job Robot

Arc Treasury Job Robot is a testnet-only stablecoin treasury operations robot for Arc Testnet.
It is not a chat bot. It is not a speculative trading bot. It is a task-driven robot that creates,
tracks, approves, executes, and reports treasury jobs with safe defaults.

The robot defaults to `dry-run` mode and stays explicit about approval gates, safety checks, and
execution state. Real execution is not enabled by default.

## What Changed From The Old Model

The earlier project centered on execution runs. v3 refactors that into a first-class treasury job system:

- jobs are the main abstraction
- the worker plans jobs from live policy and treasury state
- the dashboard centers robot status, job center, approvals, and execution timeline
- approvals are job-based instead of run-based
- the API now exposes `/api/robot/status` and `/api/jobs`

## Supported Job Types

- `rebalance`
- `wallet-top-up`
- `payout-batch`
- `treasury-sweep`
- `bridge-top-up` - clean adapter stub, disabled in the safe demo build
- `invoice-settlement` - clean adapter stub for future workflow integration

## Job Lifecycle

Jobs move through these statuses:

- `created`
- `planned`
- `awaiting-approval`
- `approved`
- `rejected`
- `submitted`
- `confirmed`
- `failed`
- `cancelled`

Typical flows:

- `dry-run`: `created` -> `planned`
- `manual-approve`: `created` -> `planned` -> `awaiting-approval` -> `approved` -> `submitted` -> `confirmed`
- blocked or unsupported execution: `created` -> `planned` -> `failed`

## Execution Modes

- `dry-run` - default mode. Plans are recorded, but nothing is submitted.
- `manual-approve` - jobs are planned and then wait for an explicit dashboard approval.
- `auto` - credential-gated mode. It remains disabled unless the required executor credentials are available and the build allows it.

## Safety Model

The robot refuses to execute when safety checks fail. The main controls are:

- global pause
- per-policy pause
- emergency stop / kill switch
- max execution amount
- daily notional cap
- cooldown period
- destination allowlist

Bridge top-up and Circle-based execution stay optional and disabled in the demo build unless their
credentials and setup are provided.

## Repository Layout

- `apps/web` - Next.js frontend and robot dashboard
- `apps/worker` - scheduled robot service and JSON state API
- `packages/shared` - shared Arc, policy, ERC20, and robot/job helpers
- `packages/contracts` - Solidity contract and Foundry scripts

## Arc Testnet Details

- Chain ID: `5042002`
- RPC: `https://rpc.testnet.arc.network`
- Explorer: `https://testnet.arcscan.app`
- Native currency: `USDC`
- Native USDC decimals: `18`
- USDC token address used by the app: `0x3600000000000000000000000000000000000000`

## Demo Environment

Use these exact values for the safe demo path.

### Web

```bash
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
TREASURY_POLICY_ADDRESS=0x4bFa1e67B1163B452d39f27F799B0A7D28F545f6
NEXT_PUBLIC_EXECUTION_API_URL=http://127.0.0.1:8787
```

### Worker

```bash
ARC_TESTNET_RPC_URL=https://rpc.testnet.arc.network
TREASURY_POLICY_ADDRESS=0x4bFa1e67B1163B452d39f27F799B0A7D28F545f6
TREASURY_EXECUTION_ADDRESS=0x0000000000000000000000000000000000000004
EXECUTION_MODE=dry-run
EXECUTION_STATE_PATH=./data/execution-state.json
EXECUTION_BALANCE_OVERRIDE_USDC=10
EXECUTION_POLL_INTERVAL_MS=60000
EXECUTION_GLOBAL_PAUSE=false
EXECUTION_POLICY_PAUSED=false
EXECUTION_EMERGENCY_STOP=false
EXECUTION_MAX_EXECUTION_AMOUNT_USDC=1000
EXECUTION_DAILY_NOTIONAL_CAP_USDC=5000
EXECUTION_COOLDOWN_MINUTES=30
EXECUTION_DESTINATION_ALLOWLIST=
EXECUTION_REBALANCE_DESTINATION_ADDRESS=
EXECUTION_PAYOUT_BATCHES_JSON=
EXECUTION_BRIDGE_TOP_UP_ENABLED=false
```

## Public Demo

When pointing the deployed frontend at the live public worker, use:

```bash
NEXT_PUBLIC_EXECUTION_API_URL=https://wine-bacterial-only-drives.trycloudflare.com
```

The public demo worker should remain in safe mode:

- `EXECUTION_MODE=manual-approve`
- Circle executor disabled
- bridge execution disabled
- `EXECUTION_GLOBAL_PAUSE=false`
- `EXECUTION_POLICY_PAUSED=false`
- `EXECUTION_EMERGENCY_STOP=false`

Optional, future-only variables:

- `CIRCLE_API_KEY`
- `CIRCLE_ENTITY_SECRET`
- `CIRCLE_WALLET_ADDRESS`
- `CIRCLE_WALLET_BLOCKCHAIN`
- `BRIDGE_SOURCE_CHAIN`
- `BRIDGE_SOURCE_WALLET_ADDRESS`
- `BRIDGE_DESTINATION_CHAIN`
- `BRIDGE_DESTINATION_WALLET_ADDRESS`

## Local Run Steps

1. Install dependencies from the repository root.

   ```bash
   pnpm install
   ```

2. Start the worker.

   ```bash
   pnpm worker:dev
   ```

3. Start the frontend.

   ```bash
   pnpm dev
   ```

4. Open the dashboard at `http://localhost:3000/dashboard`.

## Demo Flow

1. Start the worker with the demo env block above.
2. Start the frontend with the demo env block above.
3. Open `/dashboard` and confirm the robot status, safety controls, and job center load.
4. Click `Evaluate now` to have the worker read the live policy and create a job.
5. Use the pending approval controls when the worker is in `manual-approve` mode.
6. Keep `auto` off unless the credential-gated executor path is intentionally added later.

## API Surface

- `GET /api/robot/status`
- `GET /api/jobs`
- `GET /api/jobs/:id`
- `POST /api/jobs`
- `POST /api/jobs/:id/approve`
- `POST /api/jobs/:id/reject`
- `POST /api/jobs/:id/cancel`

## Validation Commands

```bash
pnpm contracts:build
pnpm contracts:test
pnpm worker:build
pnpm worker:test
pnpm worker:typecheck
pnpm typecheck
pnpm build
```

## Notes

- The app stays testnet-only.
- The worker persists robot state and jobs to a local JSON file by default.
- Real execution is disabled unless the build and credentials intentionally enable it.
- Bridge execution remains an optional adapter and does not block the rest of the robot.
