# Arc USDC Rebalancer

Arc USDC Rebalancer is a beginner-friendly treasury dashboard for Arc Testnet.
It is not a trading bot. It helps a user:

- connect a wallet
- detect Arc Testnet
- read the wallet's USDC balance
- save a treasury policy locally
- simulate a rebalance
- review a small activity log
- prepare for a future TreasuryPolicy contract integration

## Stack

- Next.js
- TypeScript
- Tailwind CSS
- shadcn/ui
- wagmi
- viem
- Solidity
- Foundry

## Repository Layout

- `apps/web` - Next.js frontend
- `packages/shared` - shared Arc and treasury helpers
- `packages/contracts` - Solidity contract and Foundry scripts

## Arc Testnet Details

- Chain ID: `5042002`
- RPC: `https://rpc.testnet.arc.network`
- Explorer: `https://testnet.arcscan.app`
- Native currency: `USDC`
- Native USDC decimals: `18`
- USDC token address used by the app: `0x3600000000000000000000000000000000000000`

## Local Setup

Install dependencies from the repository root:

```bash
pnpm install
```

Run the frontend:

```bash
pnpm dev
```

Open:

- `http://localhost:3000`
- `http://localhost:3000/dashboard`

## Frontend Commands

```bash
pnpm --filter @arc-usdc-rebalancer/web lint
pnpm --filter @arc-usdc-rebalancer/web typecheck
pnpm --filter @arc-usdc-rebalancer/web build
pnpm --filter @arc-usdc-rebalancer/web start
```

## Contract Commands

The contract package uses Foundry.

Install Foundry if needed:

```bash
curl -L https://foundry.paradigm.xyz | bash
source "$HOME/.zshenv"
foundryup
```

Build and test the contract package:

```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd packages/contracts
forge build
forge test
```

## Environment Variables

Frontend:

- No environment variables are required for the MVP.

Contracts:

- `ARC_TESTNET_RPC_URL` - Arc Testnet RPC endpoint
- `PRIVATE_KEY` - deployer private key for the Arc Testnet account
- `MIN_THRESHOLD_USDC` - policy minimum threshold in whole USDC
- `TARGET_BALANCE_USDC` - policy target balance in whole USDC
- `MAX_REBALANCE_AMOUNT_USDC` - maximum rebalance amount in whole USDC

A sample file is available at `packages/contracts/.env.example`.

Load the values before deploying:

```bash
cd packages/contracts
set -a
source .env
set +a
```

## Deploy to Arc Testnet

Compile first:

```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd packages/contracts
forge build
```

Deploy the contract and seed the initial policy:

```bash
export PATH="$HOME/.foundry/bin:$PATH"
cd packages/contracts
forge script script/DeployTreasuryPolicy.s.sol:DeployTreasuryPolicy \
  --rpc-url "$ARC_TESTNET_RPC_URL" \
  --broadcast
```

The deploy script reads `PRIVATE_KEY` and the policy values from the environment.

## How To Test The App

1. Open the dashboard at `/dashboard`.
2. Connect an injected wallet such as MetaMask or Rabby.
3. Switch the wallet to Arc Testnet if prompted.
4. Confirm the wallet address and USDC balance display correctly.
5. Edit the treasury policy fields and save locally.
6. Click `Simulate rebalance` to preview the treasury action.
7. Review the activity log for saved policy and simulation events.

If the wallet has no Arc Testnet funds, the balance card will still load but will show `0` until the account is funded.

## GitHub And Vercel Notes

- Commit and push the repo as a normal GitHub project.
- In Vercel, set the project root directory to `apps/web`.
- Vercel does not need extra frontend env vars for this MVP.
- The contract package is separate and can be deployed independently from the frontend.

## Notes

- The dashboard stores policy and activity locally first.
- Onchain integration is intentionally left for the next step.
- The app uses Arc Testnet chain detection, not speculative market logic.
