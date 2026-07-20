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

## Review path

1. Open the [public dashboard](https://web-eight-chi-99.vercel.app/dashboard).
2. Compare the three sample balance states and inspect the recommendation.
3. Copy or download the action pack and confirm the decision receipt says `not published`.
4. Confirm the dashboard keeps execution locked in public preview.
5. Review the [case study](https://web-eight-chi-99.vercel.app/case-study), [source repository](https://github.com/sin199/arc-usdc-rebalancer), [deck](https://github.com/sin199/arc-usdc-rebalancer/raw/main/docs/arc-usdc-rebalancer-defi-treasury-deck.pptx), and [3-minute demo](https://raw.githubusercontent.com/sin199/arc-usdc-rebalancer/main/docs/arc-treasury-agent-demo.mp4).

## Boundaries

- No private key is collected by the site.
- No live action runs from preview mode.
- No onchain receipt or treasury transaction is implied without a published transaction hash.
- Arc Testnet RPC outages or rate limits degrade the brief to a safe non-executable state.
