# Arc USDC Rebalancer: report-first treasury operations on Arc Testnet

## Summary

Arc USDC Rebalancer is a public Arc Testnet DeFi Treasury demo built around one simple flow: readiness checker first, treasury operations brief second, and a future operator execution path. Visitors can open the dashboard without a wallet, generate a readiness report, compare treasury scenarios, and copy either the markdown report or the action pack. Production execution is disabled for this revision; the operator path remains visible only to show the gates required before any future signed action.

## What I built

- A public homepage that explains the 30-second visitor path.
- A dashboard that produces a readable treasury readiness report from the current balance and policy band.
- A copyable markdown report and action pack for chat, docs, GitHub, or terminal use.
- A deterministic decision receipt generated with every copied or downloaded action pack. It binds the policy source, policy, balance, action, amount, Arc chain, and observation time; it is explicitly marked `not published` until a transaction hash exists.
- A visible treasury operations brief that explains the policy workflow and live control path.
- A future live-execution path that stays locked until the operator and live dependencies are ready; it is disabled in the production deployment.
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
- Future operator mode for signed execution after the production execution flag is enabled and every gate passes

## Public visitor flow

1. Open the homepage.
2. Open the dashboard.
3. Generate a readiness report.
4. Compare treasury scenarios such as below minimum, at target, or above target.
5. Copy the markdown report or action pack.
6. Confirm the action-pack decision receipt is marked `not published`.
7. Stop there if you only want the public demo.

## Operator flow

1. Connect the operator wallet.
2. Load the live onchain policy snapshot.
3. Confirm Circle readiness.
4. Confirm the TreasuryExecutor.
5. Review the actionable report.
6. Treat execution as a future, separately reviewed operation. It is disabled in the current production deployment.

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
- Three-minute demo video: [https://raw.githubusercontent.com/sin199/arc-usdc-rebalancer/main/docs/arc-treasury-agent-demo.mp4](https://raw.githubusercontent.com/sin199/arc-usdc-rebalancer/main/docs/arc-treasury-agent-demo.mp4)

## Deployment evidence

| Item | Evidence |
| --- | --- |
| Production URL | `https://web-eight-chi-99.vercel.app` |
| Public deployment | `https://web-eight-chi-99.vercel.app` |
| Current public repo | `sin199/arc-usdc-rebalancer` |
| Arc House post | Not published; no unrelated Agentic Economy resource is presented as project evidence |
| GitHub repo | `sin199/arc-usdc-rebalancer` |
| README alignment | README states `Readiness checker + treasury operations brief + gated future execution` and links this pack |
| Video evidence | Public three-minute H.264/AAC demo linked above |
| Lint status | `pnpm lint` passed |
| Build status | `pnpm build` passed |
| Alias check | Production alias and latest deployment render the same public demo copy |

## Current onchain proof status

- The public demo already proves the report-first readiness flow on Arc Testnet: a visitor can inspect the readiness report, review the recommendation, and copy the markdown report or action pack without a wallet.
- The action pack and locked execution boundary are both visible in production, so the demo shows where execution would begin and where it remains intentionally gated.
- Decision receipts are generated locally with the exported action pack. The optional registry contract is not deployed, and no receipt is represented as onchain evidence.
- No Arc Testnet `top_up` or `trim` transaction hash is published yet for this revision.
- Live execution remains gated behind the operator wallet, live policy snapshot, Circle wallet-set readiness, and executor configuration.
- No execution gates were bypassed to create this submission evidence.

## Screenshot checklist

Capture these six states from the live site:

1. Homepage hero.
2. Dashboard below minimum showing the top_up recommendation.
3. Dashboard at target showing the hold recommendation.
4. Dashboard above target showing the trim recommendation.
5. Dashboard execution locked state.
6. Action pack with its `not published` decision-receipt notice.

## Suggested Arc House post

Title: Arc USDC Rebalancer: report-first treasury operations on Arc Testnet

Body:

I shipped Arc USDC Rebalancer as a public Arc Testnet DeFi Treasury demo built around a simple flow: readiness checker first, treasury operations brief second, and a gated future execution path.

Visitors can open the dashboard without a wallet, generate a readiness report, compare treasury scenarios, and copy a markdown report or action pack.

Production execution stays disabled. The future operator path remains explicitly gated behind operator wallet, live policy, Circle readiness, executor, and an actionable report.

Demo: https://web-eight-chi-99.vercel.app/dashboard

## Short social post

Arc USDC Rebalancer is live on Arc Testnet: policy-bound USDC treasury operations and a report-first treasury brief. Visitors can generate a readiness report and copy an action pack without a wallet. Production execution is disabled. https://web-eight-chi-99.vercel.app/dashboard
