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
- execute stablecoin top-up or trim actions through a treasury vault contract
- surface Circle-ready wallet and bridge configuration for cross-chain USDC workflows

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
- `TREASURY_EXECUTOR_ADDRESS` - deployed `TreasuryExecutor` contract address from the Arc Testnet deployment
- `NEXT_PUBLIC_CIRCLE_WALLET_SET_ID` - optional wallet set to surface in the dashboard without creating a new one
- `CIRCLE_API_KEY` - Circle developer API key for server-side wallet operations
- `CIRCLE_ENTITY_SECRET` - Circle entity secret for dev-controlled wallet creation and signing
- `CIRCLE_WALLET_SET_ID` - optional Circle wallet set to reuse for live wallet listing
- `CIRCLE_WALLET_SET_NAME` - name used when the dashboard creates a new wallet set
- `CIRCLE_WALLET_NAME` - name used when the dashboard creates a new wallet
- `CIRCLE_WALLET_BLOCKCHAIN` - target blockchain for the created wallet, default `ARC-TESTNET`
- `CIRCLE_WALLET_ACCOUNT_TYPE` - `EOA` or `SCA`
- `CIRCLE_GATEWAY_API_BASE` - Gateway API base, default testnet endpoint
- `CIRCLE_GATEWAY_SOURCE_DOMAIN` - Gateway source domain, default `26` for Arc Testnet
- `CIRCLE_GATEWAY_DESTINATION_DOMAIN` - Gateway destination domain, default `6` for Base Sepolia

The frontend treats the contract addresses as required for onchain reads, policy writes, and treasury execution.

### Circle-ready cross-chain line

The dashboard also exposes a Circle readiness surface for the current USDC / Arc / wallet / executor / bridge path and now includes live Circle Wallets and Gateway API calls.

Copy `apps/web/.env.example` to `apps/web/.env.local` and optionally tune:

- `NEXT_PUBLIC_CIRCLE_WALLET_MODE` - `developer-controlled`, `user-controlled`, or `modular`
- `NEXT_PUBLIC_CIRCLE_TRANSFER_MODE` - `gateway` or `bridge-stablecoin`
- `NEXT_PUBLIC_CIRCLE_SOURCE_CHAIN` - source chain label shown in the dashboard
- `NEXT_PUBLIC_CIRCLE_DESTINATION_CHAIN` - destination chain label shown in the dashboard
- `NEXT_PUBLIC_CIRCLE_WALLET_SET_ID` - optional wallet set ID shown in the dashboard

Defaults point at the current Arc Testnet workflow and are safe to leave as-is for the existing dashboard.

### Circle bootstrap

If you need to create a fresh Circle developer secret and wallet set, run:

```bash
pnpm circle:bootstrap
```

The command generates a new entity secret, registers it with Circle, creates an Arc Testnet wallet set, and provisions one developer-controlled wallet. It prints the generated secret and the wallet set details to stdout and writes the Circle recovery file to `/tmp/arc-circle-recovery` by default.

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

After deployment, copy the contract addresses from the Forge output into `apps/web/.env.local` as `TREASURY_POLICY_ADDRESS` and `TREASURY_EXECUTOR_ADDRESS`.

### Frontend run

```bash
pnpm --filter @arc-usdc-rebalancer/web dev
```

## Manual Arc Testnet Checklist

1. Deploy `TreasuryPolicy` to Arc Testnet with the Foundry script.
2. Deploy `TreasuryExecutor` to Arc Testnet with the Foundry script.
3. Put the deployed contract addresses into `apps/web/.env.local`.
4. Start the frontend and open `/dashboard`.
5. Connect the owner wallet that deployed the contract.
6. Confirm the wallet badge shows the connected address and owner status.
7. Confirm the dashboard reads the current policy from chain.
8. Confirm the latest `PolicyUpdated` event appears after deployment or after a policy change.
9. Edit the policy values and submit the update from the owner wallet.
10. Confirm the transaction is accepted on Arc Testnet and the latest event refreshes.
11. Confirm the stablecoin robot shows an execution-ready state when the executor address is configured.
12. Run a top-up or trim path and confirm the treasury executor balance changes on chain.
13. Try the same update flow with a non-owner wallet and confirm the submit and execute actions are blocked.

## GitHub And Vercel Notes

- Commit and push the repo as a normal GitHub project.
- In Vercel, set the project root directory to `apps/web`.
- Set the Arc runtime env values in Vercel for the frontend deployment.
- The contract package is separate and can be deployed independently from the frontend.

## Notes

- The dashboard reads and writes the deployed contract on Arc Testnet only.
- The app does not claim privacy features or advanced automation.
- The simulation panel is a local preview of policy-driven treasury behavior, and the executor panel only becomes live when the executor address is configured.
- The Circle line panel is a configuration and readiness surface for the current Arc USDC workflow, not a separate wallet provider integration.
- The Circle control plane panel talks to Circle Wallets and Gateway APIs when `CIRCLE_API_KEY` and `CIRCLE_ENTITY_SECRET` are configured.
