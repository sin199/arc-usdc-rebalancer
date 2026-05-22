# Arc USDC Rebalancer: report-first treasury operations on Arc Testnet

## Summary

Arc USDC Rebalancer is a public Arc Testnet treasury demo built around one simple flow: readiness checker first, operator brief second, optional live execution. Visitors can open the dashboard without a wallet, generate a readiness report, compare treasury scenarios, and copy either the markdown report or the action pack. Live execution only appears when the operator wallet, live policy, Circle readiness, executor, and actionable report are all ready.

## What I built

- A public homepage that explains the 30-second visitor path.
- A dashboard that produces a readable treasury readiness report from the current balance and policy band.
- A copyable markdown report and action pack for chat, docs, GitHub, or terminal use.
- A visible operator brief that explains the installed agent and the live control path.
- A live execution path that stays locked until the operator and live dependencies are ready.
- A Circle control plane surface for developer-controlled wallets and Gateway readiness.
- A safe treasury-ops interface for Arc Testnet, not a silent trading bot.

## Why it matters for Arc

This project shows Arc in a way that is easy to inspect and hard to misunderstand.

- It demonstrates a report-first way to operate stablecoin treasury workflows on Arc Testnet.
- It makes the live operator path explicit instead of hiding execution behind a generic dashboard.
- It gives the community a concrete example of how agent identity, treasury policy, Circle readiness, and execution gating can live in one place.
- It is a readable builder artifact that can be reviewed, shared, and replayed without guessing how the system works.

## Arc surfaces used

- Arc Testnet chain state
- Arc Testnet RPC
- TreasuryPolicy reads and owner-gated updates
- TreasuryExecutor for USDC movement
- Arc agent identity and validation state
- Operator brief for the installed robot
- Circle developer-controlled wallets
- Circle Gateway readiness
- Public demo mode for visitors without a wallet
- Operator mode for signed execution

## Public visitor flow

1. Open the homepage.
2. Open the dashboard.
3. Generate a readiness report.
4. Compare treasury scenarios such as below minimum, at target, or above target.
5. Copy the markdown report or action pack.
6. Stop there if you only want the public demo.

## Operator flow

1. Connect the operator wallet.
2. Load the live onchain policy snapshot.
3. Confirm Circle readiness.
4. Confirm the TreasuryExecutor.
5. Review the actionable report.
6. Execute only when the page shows live operator mode and the controls are explicitly unlocked.

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
- Operator brief: [https://web-eight-chi-99.vercel.app/operator](https://web-eight-chi-99.vercel.app/operator)
- Case study: [https://web-eight-chi-99.vercel.app/case-study](https://web-eight-chi-99.vercel.app/case-study)
- GitHub repo: [https://github.com/sin199/arc-usdc-rebalancer](https://github.com/sin199/arc-usdc-rebalancer)

## Deployment evidence

| Item | Evidence |
| --- | --- |
| Production URL | `https://web-eight-chi-99.vercel.app` |
| Latest deployment URL | `https://web-dn7aynyz7-sin199s-projects.vercel.app` |
| Deployment hash | `dpl_A2ypsJAXorD9wv9RQFC1tdKLHQCu` |
| Commit hash | `e0f5e337` |
| Arc House post link | [community.arc.network/home/clubs/agentic-economy-dofua/resources/circle-agent-stack-builder-feedback-2026-05-12](https://community.arc.network/home/clubs/agentic-economy-dofua/resources/circle-agent-stack-builder-feedback-2026-05-12) |
| GitHub repo | `sin199/arc-usdc-rebalancer` |
| README alignment | README now states `Readiness checker + operator brief + optional live execution` and links this pack |
| Lint status | `pnpm lint` passed |
| Build status | `pnpm build` passed |
| Alias check | Production alias and latest deployment render the same public demo copy |

## Current onchain proof status

- The public demo already proves the report-first readiness flow on Arc Testnet: a visitor can inspect the readiness report, review the recommendation, and copy the markdown report or action pack without a wallet.
- The action pack and locked execution boundary are both visible in production, so the demo shows where execution would begin and where it remains intentionally gated.
- No Arc Testnet `top_up` or `trim` transaction hash is published yet for this revision.
- Live execution remains gated behind the operator wallet, live policy snapshot, Circle wallet-set readiness, and executor configuration.
- No execution gates were bypassed to create this submission evidence.

## Screenshot checklist

Capture these five states from the live site:

1. Homepage hero.
2. Dashboard below minimum showing the top_up recommendation.
3. Dashboard at target showing the hold recommendation.
4. Dashboard above target showing the trim recommendation.
5. Dashboard execution locked state.

## Suggested Arc House post

Title: Arc USDC Rebalancer: report-first treasury operations on Arc Testnet

Body:

I shipped Arc USDC Rebalancer as a public Arc Testnet treasury demo built around a simple flow: readiness checker first, operator brief second, optional live execution.

Visitors can open the dashboard without a wallet, generate a readiness report, compare treasury scenarios, and copy a markdown report or action pack.

Live execution stays explicitly gated behind operator wallet, live policy, Circle readiness, executor, and an actionable report.

Demo: https://web-eight-chi-99.vercel.app/dashboard

## Short social post

Arc USDC Rebalancer is live on Arc Testnet: report-first treasury ops, operator brief, and optional live execution. Visitors can generate a readiness report and copy an action pack without a wallet. https://web-eight-chi-99.vercel.app/dashboard
