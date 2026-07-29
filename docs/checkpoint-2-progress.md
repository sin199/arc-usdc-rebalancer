# Checkpoint 2 progress: Arc USDC Rebalancer

## Scope

Arc USDC Rebalancer is a DeFi Track project for reviewable USDC treasury operations on Arc Testnet. It determines a bounded `top_up`, `hold`, or `trim` recommendation from a treasury policy and current balance, then keeps execution separate and visibly gated.

## Completed by July 20, 2026

- Public dashboard with below-minimum, at-target, and above-target scenarios.
- Arc Testnet policy, executor, and identity evidence surfaced beside Circle readiness.
- Deterministic backtest shared by the CLI, tests, API, and public dashboard: 1,003 balance cases, 100.00% agreement, 0 cap violations, and 9/9 safety gates passed.
- Copyable readiness reports and action packs for review without a wallet.
- Deterministic decision receipts generated with action-pack exports. A receipt binds chain, policy source, policy, balance, action, amount, relevant addresses, and observation time. It is marked `not published`; the optional receipt registry is not deployed.
- Production execution remains disabled. The public deployment does not claim submitted treasury transactions.

## Evidence and terminology

- **Arc provenance:** the dashboard is configured for Arc Testnet chain `5042002` using the public [Arc Testnet RPC](https://rpc.testnet.arc.network/). The read path is wired to `TreasuryPolicy` at `0x4bFa1e67B1163B452d39f27F799B0A7D28F545f6` and `TreasuryExecutor` at `0x5c5d0275371724779f3a6928eb0312df2b1a501f`. The public dashboard displays whether each policy, executor-balance, and validation read is live, cached, or unavailable.
- **Circle readiness:** this label means the configured Circle developer-controlled wallet set and Gateway control-plane state can be read by the application. It is a dependency-readiness signal, not proof of custody, a completed transfer, or permission to execute.
- **Transaction evidence:** Checkpoint 2 contains no published Arc transaction hash and no onchain treasury-execution evidence. The submission does not rely on a private, local, CLI, or public transaction to establish its claims.

## Review path

1. Open the [public dashboard](https://web-eight-chi-99.vercel.app/dashboard).
2. Compare the three sample balance states and inspect the recommendation.
3. Copy or download the action pack and confirm the decision receipt says `not published`.
4. Confirm the dashboard keeps execution locked in public preview.
5. Review the [case study](https://web-eight-chi-99.vercel.app/case-study), [source repository](https://github.com/sin199/arc-usdc-rebalancer), [deck](https://cdn.jsdelivr.net/gh/sin199/arc-usdc-rebalancer@main/docs/arc-usdc-rebalancer-defi-treasury-deck.pdf), and [3-minute demo](https://web-eight-chi-99.vercel.app/demo).

## Boundaries

- No private key is collected by the site.
- No live action runs from preview mode.
- No onchain receipt or treasury transaction is implied without a published transaction hash. The Checkpoint 2 pack includes neither.
- Arc Testnet RPC outages or rate limits degrade the brief to a safe non-executable state.
