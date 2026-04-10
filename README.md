# Arc USDC Rebalancer

Arc USDC Rebalancer is a testnet-only treasury dashboard for Arc Testnet.
It is not a trading bot. It helps a user:

- connect a wallet
- detect Arc Testnet
- read the connected wallet's USDC balance
- read the deployed `TreasuryPolicy` contract
- submit policy updates from the owner wallet
- review the latest `PolicyUpdated` event
- simulate a rebalance against the current policy

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
pnpm --filter @arc-usdc-rebalancer/web dev
```

Open:

- `http://localhost:3000`
- `http://localhost:3000/dashboard`

## Environment Variables

The second PR uses explicit env-driven deployment and runtime config.

### Contract deployment

Copy `packages/contracts/.env.example` to `packages/contracts/.env` and set:

- `ARC_TESTNET_RPC_URL` - Arc Testnet RPC endpoint
- `PRIVATE_KEY` - deployer private key for the Arc Testnet owner wallet
- `MIN_THRESHOLD_USDC` - policy minimum threshold in whole USDC
- `TARGET_BALANCE_USDC` - policy target balance in whole USDC
- `MAX_REBALANCE_AMOUNT_USDC` - maximum rebalance amount in whole USDC

### Frontend runtime

Copy `apps/web/.env.example` to `apps/web/.env.local` and set:

- `ARC_TESTNET_RPC_URL` - Arc Testnet RPC endpoint used by the frontend
- `TREASURY_POLICY_ADDRESS` - deployed `TreasuryPolicy` contract address from the Arc Testnet deployment

The frontend treats the contract address as required for onchain policy reads and writes.

## Exact Commands

### Forge build

```bash
cd packages/contracts
forge build
```

### Forge test

```bash
cd packages/contracts
forge test
```

### Deployment

```bash
cd packages/contracts
set -a
source .env
set +a
forge script script/DeployTreasuryPolicy.s.sol:DeployTreasuryPolicy \
  --rpc-url "$ARC_TESTNET_RPC_URL" \
  --broadcast \
  --private-key "$PRIVATE_KEY"
```

After deployment, copy the contract address from the Forge output into `apps/web/.env.local` as `TREASURY_POLICY_ADDRESS`.

### Frontend run

```bash
pnpm --filter @arc-usdc-rebalancer/web dev
```

## Manual Arc Testnet Checklist

1. Deploy `TreasuryPolicy` to Arc Testnet with the Foundry script.
2. Put the deployed contract address into `apps/web/.env.local`.
3. Start the frontend and open `/dashboard`.
4. Connect the owner wallet that deployed the contract.
5. Confirm the wallet badge shows the connected address and owner status.
6. Confirm the dashboard reads the current policy from chain.
7. Confirm the latest `PolicyUpdated` event appears after deployment or after a policy change.
8. Edit the policy values and submit the update from the owner wallet.
9. Confirm the transaction is accepted on Arc Testnet and the latest event refreshes.
10. Confirm the simulated rebalance status updates when the connected balance or policy changes.
11. Try the same update flow with a non-owner wallet and confirm the submit action is blocked.

## GitHub And Vercel Notes

- Commit and push the repo as a normal GitHub project.
- In Vercel, set the project root directory to `apps/web`.
- Set the Arc runtime env values in Vercel for the frontend deployment.
- The contract package is separate and can be deployed independently from the frontend.

## Notes

- The dashboard reads and writes the deployed contract on Arc Testnet only.
- The app does not claim privacy features or advanced automation.
- The simulation panel is a local preview of policy-driven treasury behavior, not an execution engine.
