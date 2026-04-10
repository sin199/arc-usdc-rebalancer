# Arc USDC Rebalancer v3

Arc USDC Rebalancer v3 is a testnet-only stablecoin treasury execution module for Arc Testnet.
It is not an alpha bot. It is built to stay safe by default:

- `dry-run` is the default execution mode
- `manual-approve` creates plans but waits for an explicit dashboard approval
- `auto` stays disabled unless the required credentials exist
- real execution is gated by safety controls, allowlists, and cooldown limits

The repo contains:

- a Next.js frontend for treasury policy visibility and execution approval
- a server-side worker that polls Arc Testnet state on a schedule
- shared execution helpers for plan generation and safety evaluation
- Foundry contracts for the deployed `TreasuryPolicy`

## Stack

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui-style primitives
- wagmi
- viem
- Node worker service
- Solidity
- Foundry

## Repository Layout

- `apps/web` - Next.js frontend
- `apps/worker` - scheduled execution worker and JSON state API
- `packages/shared` - shared Arc, policy, ERC20, and execution helpers
- `packages/contracts` - Solidity contract and Foundry scripts

## Arc Testnet Details

- Chain ID: `5042002`
- RPC: `https://rpc.testnet.arc.network`
- Explorer: `https://testnet.arcscan.app`
- Native currency: `USDC`
- Native USDC decimals: `18`
- USDC token address used by the app: `0x3600000000000000000000000000000000000000`

## Execution Modes

- `dry-run` - evaluate policy, build a plan, and record a simulated run
- `manual-approve` - build a plan, store it as awaiting approval, and require a dashboard action before submission
- `auto` - reserved for credential-gated automation; stays disabled when the required executor credentials are missing

## Safety Model

The worker enforces these controls before it generates or submits runs:

- global pause
- per-policy pause
- emergency stop / kill switch
- max execution amount
- daily notional cap
- cooldown period
- destination allowlist

The worker also keeps execution testnet-only and records:

- latest runs
- statuses
- trigger timestamps
- human-readable logs

## Local Setup

Install dependencies from the repository root:

```bash
pnpm install
```

Start the worker:

```bash
pnpm worker:dev
```

Start the frontend:

```bash
pnpm dev
```

Open:

- `http://localhost:3000`
- `http://localhost:3000/dashboard`

## Environment Variables

### Frontend runtime

Copy `apps/web/.env.example` to `apps/web/.env.local` and set:

- `ARC_TESTNET_RPC_URL` - Arc Testnet RPC endpoint used by the frontend
- `TREASURY_POLICY_ADDRESS` - deployed `TreasuryPolicy` contract address
- `NEXT_PUBLIC_EXECUTION_API_URL` - worker API base URL, for example `http://127.0.0.1:8787`

### Worker runtime

Copy `apps/worker/.env.example` to `apps/worker/.env` and set:

- `ARC_TESTNET_RPC_URL` - Arc Testnet RPC endpoint used by the worker
- `TREASURY_POLICY_ADDRESS` - deployed `TreasuryPolicy` contract address
- `TREASURY_EXECUTION_ADDRESS` - Arc Testnet treasury wallet the worker polls
- `EXECUTION_MODE` - `dry-run`, `manual-approve`, or `auto`
- `EXECUTION_STATE_PATH` - JSON file used to persist runs and status
- `EXECUTION_POLL_INTERVAL_MS` - schedule interval in milliseconds
- `EXECUTION_BALANCE_OVERRIDE_USDC` - optional local test override for deterministic verification
- `EXECUTION_GLOBAL_PAUSE` - pause all execution
- `EXECUTION_POLICY_PAUSED` - pause the current policy
- `EXECUTION_EMERGENCY_STOP` - kill switch
- `EXECUTION_MAX_EXECUTION_AMOUNT_USDC` - max amount per run
- `EXECUTION_DAILY_NOTIONAL_CAP_USDC` - max notional per day
- `EXECUTION_COOLDOWN_MINUTES` - minimum gap between runs
- `EXECUTION_DESTINATION_ALLOWLIST` - comma-separated allowlisted destination addresses
- `EXECUTION_REBALANCE_DESTINATION_ADDRESS` - optional explicit destination for rebalance plans
- `EXECUTION_PAYOUT_BATCHES_JSON` - optional payout batch array as JSON
- `EXECUTION_BRIDGE_TOP_UP_ENABLED` - enable bridge top-up planning when bridge config exists

### Optional Circle executor credentials

`auto` mode is disabled unless these exist:

- `CIRCLE_API_KEY`
- `CIRCLE_ENTITY_SECRET`
- `CIRCLE_WALLET_ADDRESS`
- `CIRCLE_WALLET_BLOCKCHAIN`

### Optional bridge planning credentials

Bridge top-up planning stays disabled unless these exist:

- `BRIDGE_SOURCE_CHAIN`
- `BRIDGE_SOURCE_WALLET_ADDRESS`
- `BRIDGE_DESTINATION_CHAIN`
- `BRIDGE_DESTINATION_WALLET_ADDRESS`

## Commands

### Contracts build

```bash
pnpm contracts:build
```

### Contracts test

```bash
pnpm contracts:test
```

### Frontend build

```bash
pnpm build
```

### Worker build

```bash
pnpm worker:build
```

### Worker test

```bash
pnpm worker:test
```

## Local Verification Flow

1. Start the worker with `EXECUTION_MODE=dry-run`.
2. Set `EXECUTION_BALANCE_OVERRIDE_USDC` to force a deterministic plan during local testing.
3. Start the frontend and open `/dashboard`.
4. Confirm the execution module shows the current mode, safety controls, and latest runs.
5. Switch the worker to `manual-approve`.
6. Confirm the dashboard shows a run awaiting approval.
7. Approve or reject the run from the dashboard and verify the status updates.
8. Leave `auto` off unless the Circle credentials exist.

## Notes

- The app stays testnet-only.
- The worker persists execution runs to a local JSON file by default.
- Real execution is disabled unless the required credentials exist and the mode explicitly requests `auto`.
- Bridge execution remains optional and is left as a credential-gated extension.
