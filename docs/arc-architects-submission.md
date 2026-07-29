# Arc USDC Rebalancer: report-first treasury decisions on Arc Testnet

## Summary

Arc USDC Rebalancer is a deployed Arc Testnet DeFi treasury decision MVP built
around one clear flow: read live state, evaluate a bounded policy, and export
an auditable action pack.

Visitors can open the dashboard without a wallet, inspect live Arc and Circle
readiness, compare treasury scenarios, and copy either a Markdown report or an
action pack. The public deployment does not submit treasury transactions, and
that boundary is explicit throughout the product and evidence.

## What I built

- A public homepage that explains the visitor flow in about 30 seconds.
- A dashboard that combines the current executor balance, policy band, Arc
  validation, and Circle readiness in one source-labeled report.
- Deterministic `top_up`, `hold`, and `trim` recommendations bounded by the
  policy's thresholds and maximum rebalance amount.
- Copyable Markdown and JSON action packs for use in chat, documentation,
  GitHub, or an operator workflow.
- A deterministic decision receipt that binds the source, policy, balance,
  action, amount, Arc chain, and observation time. It is explicitly marked
  `not published` and contains no fabricated transaction hash.
- A visible treasury operations brief that explains the policy workflow and
  its data quality.
- Circle developer-controlled Wallets and Gateway readiness signals.
- A hard-disabled public write boundary with no wallet or signing interface.

## Why it matters for Arc

- It demonstrates a report-first way to operate a stablecoin treasury workflow
  on Arc Testnet.
- It makes the live state, policy decision, evidence, and execution boundary
  independently inspectable.
- It shows how Arc chain state, Circle readiness, and deterministic policy
  evaluation can support one reviewable treasury decision.
- It is a concrete builder artifact that can be shared and replayed without
  implying an autonomous transfer.

## Arc and Circle surfaces used

- Arc Testnet chain state and RPC
- Live TreasuryPolicy reads
- Live TreasuryExecutor USDC balance reads
- Arc-linked onchain identity validation evidence
- Arc Testnet USDC
- Circle developer-controlled Wallets readiness
- Circle Gateway readiness
- A public read-only dashboard and treasury operations brief

The repository contains a separately reviewed contract design, but the
submitted public deployment does not wire any treasury write path.

## Public visitor flow

1. Open the homepage and dashboard.
2. Inspect the live Arc policy, executor balance, validation, and Circle
   readiness.
3. Compare scenarios below the minimum, inside the policy band, and above the
   target.
4. Review the bounded `top_up`, `hold`, or `trim` recommendation.
5. Copy the Markdown report or JSON action pack.
6. Confirm that the decision receipt is marked `not published`.
7. Stop there: the public deployment is intentionally non-executing.

## Operator review flow

1. Inspect the live onchain policy snapshot.
2. Confirm the live Circle readiness signal.
3. Confirm the configured TreasuryExecutor address and balance.
4. Review the recommendation, reason codes, and decision receipt.
5. Treat any treasury write as outside this public submission. No transfer is
   sent or implied.

## Safety boundaries

- The public deployment does not silently send transactions.
- It exposes no wallet connection or signing interface.
- The legacy executor is hard-disabled and cannot be enabled by an environment
  flag.
- Preview mode never presents itself as live execution.
- Exported receipts are decision artifacts, not onchain confirmations.
- The report remains useful without a wallet or signing path.

## Demo links

- Production:
  [https://web-eight-chi-99.vercel.app](https://web-eight-chi-99.vercel.app)
- Dashboard:
  [https://web-eight-chi-99.vercel.app/dashboard](https://web-eight-chi-99.vercel.app/dashboard)
- Three-minute demo player:
  [https://web-eight-chi-99.vercel.app/demo](https://web-eight-chi-99.vercel.app/demo)
- Treasury operations brief:
  [https://web-eight-chi-99.vercel.app/operator](https://web-eight-chi-99.vercel.app/operator)
- Architecture:
  [https://web-eight-chi-99.vercel.app/architecture](https://web-eight-chi-99.vercel.app/architecture)
- Case study:
  [https://web-eight-chi-99.vercel.app/case-study](https://web-eight-chi-99.vercel.app/case-study)
- GitHub repository:
  [https://github.com/sin199/arc-usdc-rebalancer](https://github.com/sin199/arc-usdc-rebalancer)
- Hackathon deck PDF:
  [https://cdn.jsdelivr.net/gh/sin199/arc-usdc-rebalancer@main/docs/arc-usdc-rebalancer-defi-treasury-deck.pdf](https://cdn.jsdelivr.net/gh/sin199/arc-usdc-rebalancer@main/docs/arc-usdc-rebalancer-defi-treasury-deck.pdf)
- Editable hackathon deck:
  [https://raw.githubusercontent.com/sin199/arc-usdc-rebalancer/main/docs/arc-usdc-rebalancer-defi-treasury-deck.pptx](https://raw.githubusercontent.com/sin199/arc-usdc-rebalancer/main/docs/arc-usdc-rebalancer-defi-treasury-deck.pptx)
- Direct demo MP4:
  [https://cdn.jsdelivr.net/gh/sin199/arc-usdc-rebalancer@main/docs/arc-treasury-agent-demo.mp4](https://cdn.jsdelivr.net/gh/sin199/arc-usdc-rebalancer@main/docs/arc-treasury-agent-demo.mp4)

## Deployment evidence

| Item                    | Evidence                                        |
| ----------------------- | ----------------------------------------------- |
| Production URL          | `https://web-eight-chi-99.vercel.app`           |
| Public repository       | `sin199/arc-usdc-rebalancer`                    |
| Track                   | DeFi Track only                                 |
| Arc Testnet chain ID    | `5042002`                                       |
| Public execution status | `enabled: false`                                |
| Legacy executor wiring  | `false`                                         |
| Arc House post          | Not published                                   |
| Video evidence          | Public three-minute H.264/AAC demo linked above |

## Current onchain proof status

- The public demo proves a report-first decision flow backed by live Arc
  policy, executor-balance, validation, and Circle-readiness signals.
- The action pack and locked execution boundary are visible in production.
- Decision receipts are generated locally and exported with the action pack.
  The optional registry contract is not deployed, so no receipt is represented
  as onchain evidence.
- No Arc Testnet `top_up` or `trim` transaction hash is published.
- The public API reports `enabled: false`; the submitted deployment sends no
  treasury write.

## Screenshot checklist

1. Homepage hero.
2. Dashboard below the minimum with a `top_up` recommendation.
3. Dashboard inside the policy band with a `hold` recommendation.
4. Dashboard above the target with a `trim` recommendation.
5. Dashboard execution-locked state.
6. Action pack with its `not published` decision-receipt notice.

## Suggested Arc House post

**Title:** Arc USDC Rebalancer: DeFi Track treasury decisions on Arc Testnet

**Body:**

I shipped Arc USDC Rebalancer as a public Arc Testnet DeFi Track treasury
decision MVP: live policy and balance reads first, a bounded USDC decision
second, and an auditable action pack third.

Visitors can open the dashboard without a wallet, inspect live Arc and Circle
readiness, compare treasury scenarios, and copy a Markdown report or action
pack. The public deployment remains non-executing, and every exported receipt
is marked `not published`.

Demo: https://web-eight-chi-99.vercel.app/dashboard

## Short social post

Arc USDC Rebalancer is live on Arc Testnet: a DeFi Track USDC treasury decision
MVP with policy-bound recommendations, Circle Wallets and Gateway readiness,
and an auditable action pack. The public deployment sends no treasury
transaction. https://web-eight-chi-99.vercel.app/dashboard
