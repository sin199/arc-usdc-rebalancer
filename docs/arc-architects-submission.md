# Arc USDC Rebalancer: report-first treasury decision MVP on Arc Testnet

## Summary

Arc USDC Rebalancer is a deployed Arc Testnet DeFi Treasury decision MVP built around one simple flow: live state read first, policy decision second, and auditable action pack third. Visitors can open the dashboard without a wallet, inspect live Arc and Circle readiness, compare treasury scenarios, and copy either the markdown report or the action pack. The public deployment does not submit treasury transactions; that boundary is explicit in the product and evidence.

## What I built

- A public homepage that explains the 30-second visitor path.
- A dashboard that produces a readable treasury readiness report from the current balance and policy band.
- A copyable markdown report and action pack for chat, docs, GitHub, or terminal use.
- A deterministic decision receipt generated with every copied or downloaded action pack. It binds the policy source, policy, balance, action, amount, Arc chain, and observation time; it is explicitly marked `not published` until a transaction hash exists.
- A visible treasury operations brief that explains the policy workflow and live control path.
- A public write boundary that stays hard-disabled; no treasury transfer is claimed as evidence.
- A Circle control plane surface for developer-controlled wallets and Gateway readiness.
- A safe treasury-ops interface for Arc Testnet, not a silent trading bot.

## Why it matters for Arc

This project shows Arc in a way that is easy to inspect and hard to misunderstand.

- It demonstrates a report-first way to operate stablecoin treasury workflows on Arc Testnet.
- It makes the live operator path explicit instead of hiding execution behind a generic dashboard.
- It gives the community a concrete example of how onchain identity evidence, treasury policy, Circle readiness, and execution gating can live in one place.
- It is a readable builder artifact that can be reviewed, shared, and replayed without guessing how the system works.

## Arc surfaces used

- Arc Testnet chain state
- Arc Testnet RPC
- TreasuryPolicy reads and owner-gated updates
- TreasuryExecutor for USDC movement
- Arc-linked onchain identity and validation evidence
- Treasury operations brief for the policy workflow
- Circle developer-controlled wallets
- Circle Gateway readiness
- Public demo mode for visitors without a wallet
- A separately reviewed operator-write design, not claimed as active production behavior

## Public visitor flow

1. Open the homepage.
2. Open the dashboard.
3. Generate a readiness report.
4. Compare treasury scenarios such as below minimum, at target, or above target.
5. Copy the markdown report or action pack.
6. Confirm the action-pack decision receipt is marked `not published`.
7. Stop there: the public demo is intentionally non-executing.

## Operator flow

1. Inspect the live onchain policy snapshot.
2. Confirm the live Circle readiness signal.
3. Confirm the configured TreasuryExecutor address and balance read.
4. Review the actionable report and exported decision receipt.
5. Treat any treasury write as outside this public submission; no transfer is sent or implied.

## Safety boundaries

- It does not silently send transactions.
- It does not execute without a live signer and Circle configuration.
- It does not present itself as a profit bot.
- Preview mode never pretends to be live execution.
- Live execution is gated by visible readiness checks.
- The report remains useful even when live signing is unavailable.

## Demo links

- Production: [https://web-eight-chi-99.vercel.app](https://web-eight-chi-99.vercel.app)
- Dashboard: [https://web-eight-chi-99.vercel.app/dashboard](https://web-eight-chi-99.vercel.app/dashboard)
- Treasury operations brief: [https://web-eight-chi-99.vercel.app/operator](https://web-eight-chi-99.vercel.app/operator)
- Case study: [https://web-eight-chi-99.vercel.app/case-study](https://web-eight-chi-99.vercel.app/case-study)
- GitHub repo: [https://github.com/sin199/arc-usdc-rebalancer](https://github.com/sin199/arc-usdc-rebalancer)
- Hackathon deck: [https://github.com/sin199/arc-usdc-rebalancer/raw/main/docs/arc-usdc-rebalancer-defi-treasury-deck.pptx](https://github.com/sin199/arc-usdc-rebalancer/raw/main/docs/arc-usdc-rebalancer-defi-treasury-deck.pptx)
- Three-minute demo video: [https://raw.githubusercontent.com/sin199/arc-usdc-rebalancer/main/docs/arc-treasury-agent-demo.mp4](https://raw.githubusercontent.com/sin199/arc-usdc-rebalancer/main/docs/arc-treasury-agent-demo.mp4)

## Deployment evidence

| Item | Evidence |
| --- | --- |
| Production URL | `https://web-eight-chi-99.vercel.app` |
| Public deployment | `https://web-eight-chi-99.vercel.app` |
| Current public repo | `sin199/arc-usdc-rebalancer` |
| Arc House post | Not published; no unrelated Agentic Economy resource is presented as project evidence |
| GitHub repo | `sin199/arc-usdc-rebalancer` |
| README alignment | README states `Deployed Arc Testnet decision MVP + report-first public deployment` and links this pack |
| Video evidence | Public three-minute H.264/AAC demo linked above |
| Lint status | `pnpm lint` passed |
| Build status | `pnpm build` passed |
| Alias check | Production alias and latest deployment render the same public demo copy |

## Current onchain proof status

- The public demo proves a report-first decision flow on Arc Testnet: a visitor can inspect live policy, executor-balance, validation, and Circle-readiness signals, review the recommendation, and copy the markdown report or action pack without a wallet.
- The action pack and locked execution boundary are both visible in production, so the demo shows where execution would begin and where it remains intentionally gated.
- Decision receipts are generated locally with the exported action pack. The optional registry contract is not deployed, and no receipt is represented as onchain evidence.
- No Arc Testnet `top_up` or `trim` transaction hash is published yet for this revision.
- The public API reports `enabled: false`; no treasury write is sent by the submitted deployment.
- The public evidence boundary is intentional: no execution gate was bypassed and no treasury transfer is implied.

## Screenshot checklist

Capture these six states from the live site:

1. Homepage hero.
2. Dashboard below minimum showing the top_up recommendation.
3. Dashboard at target showing the hold recommendation.
4. Dashboard above target showing the trim recommendation.
5. Dashboard execution locked state.
6. Action pack with its `not published` decision-receipt notice.

## Suggested Arc House post

Title: Arc USDC Rebalancer: DeFi Track treasury decisions on Arc Testnet

Body:

I shipped Arc USDC Rebalancer as a public Arc Testnet DeFi Track treasury decision MVP: live policy and balance read first, bounded USDC decision second, and an auditable action pack third.

Visitors can open the dashboard without a wallet, generate a readiness report, compare treasury scenarios, and copy a markdown report or action pack.

The public deployment stays non-executing. It uses Arc Testnet, USDC policy state, and Circle developer-controlled wallet/Gateway readiness signals, and it clearly marks exported receipts as not published.

Demo: https://web-eight-chi-99.vercel.app/dashboard

## Short social post

Arc USDC Rebalancer is live on Arc Testnet: a DeFi Track USDC treasury decision MVP with policy-bound reports, Circle Wallets/Gateway readiness, and an auditable action pack. The public deployment sends no treasury transaction. https://web-eight-chi-99.vercel.app/dashboard
