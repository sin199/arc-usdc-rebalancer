# Final Submission Pack

## Official requirements

Encode Club's Final Submission is due on Sunday, 9 August 2026, Anywhere on
Earth (UTC-12). The required deliverables are:

- a functional MVP;
- a three-minute pitch demo covering what was built, how it works, the
  selected track, and the core products used;
- a presentation deck;
- a public code repository.

Submit the project to the **DeFi Track only**.

## Track selection

Arc USDC Rebalancer is DeFi treasury infrastructure built with Arc and USDC,
which is an explicit fit for the DeFi Track. The submission does not claim
Agentic Economy Track eligibility, autonomous custody, or an agent-controlled
wallet.

## Final description

DeFi treasury operators need an auditable way to decide whether to top up,
hold, or trim USDC before funds move.

Arc USDC Rebalancer is a deployed Arc Testnet DeFi treasury decision MVP. It
reads the live TreasuryPolicy and executor USDC balance, checks Arc-linked
validation plus Circle developer-controlled Wallets and Gateway readiness,
evaluates a bounded `top_up`, `hold`, or `trim` decision, and exports an
auditable Markdown report and action pack.

The public deployment is intentionally read-only. It reports `enabled: false`,
exposes neither a wallet connection nor a signed execution path, sends no
treasury transaction, and marks exported decision receipts as `not published`.

## Submission links

- MVP: https://web-eight-chi-99.vercel.app/dashboard
- Architecture and Arc evidence:
  https://web-eight-chi-99.vercel.app/architecture
- Reproducible case study:
  https://web-eight-chi-99.vercel.app/case-study
- Public repository: https://github.com/sin199/arc-usdc-rebalancer
- Three-minute video:
  https://raw.githubusercontent.com/sin199/arc-usdc-rebalancer/main/docs/arc-treasury-agent-demo.mp4
- Presentation:
  https://github.com/sin199/arc-usdc-rebalancer/raw/main/docs/arc-usdc-rebalancer-defi-treasury-deck.pptx

## Three-minute demo path

1. `0:00-0:10` - Identify the DeFi Track and the Arc, USDC, Circle Wallets,
   and Gateway stack.
2. `0:10-0:40` - Show the live Arc policy, executor balance, validation, data
   quality, and Circle readiness.
3. `0:40-1:10` - Demonstrate the below-minimum `top_up` and in-band `hold`
   outcomes.
4. `1:10-1:40` - Demonstrate the above-target `trim`, exported action pack,
   and absence of a transaction hash.
5. `1:40-2:40` - Show the hard execution lock, Arc chain evidence, fail-closed
   architecture, and reproducible case study.
6. `2:40-3:00` - Close with the exact boundary: the MVP prepares a reviewable
   action and does not claim a completed treasury transfer.

The video is exactly 180 seconds at 1280x720, with H.264 video and AAC audio.
The visuals were rebuilt from the current read-only production interface on
28 July 2026. The narration was independently transcribed and reconciled with
the public read-only boundary on 28 July 2026.

## Reviewer-verifiable facts

- Arc Testnet chain ID: `5042002`
- TreasuryPolicy:
  `0x4bFa1e67B1163B452d39f27F799B0A7D28F545f6`
- TreasuryExecutor:
  `0x5c5d0275371724779f3a6928eb0312df2b1a501f`
- Arc Testnet USDC:
  `0x3600000000000000000000000000000000000000`
- Public execution status: `enabled: false`
- Legacy executor wiring: `false`
- Deterministic verification: 1,003 balance cases, 100% expected-action
  agreement, 9/9 safety gates, and zero submitted transactions

A dated read-only capture is in
[`arc-testnet-evidence.json`](./arc-testnet-evidence.json). It contains no
private key, wallet credential, or fabricated transaction hash.

## Submission gate

**Go** only when the Final Submission form is open and all six public links
above return successfully.

**No-go** if any form text, video narration, or deck copy claims live treasury
movement, autonomous custody, a confirmed Arc transaction, or Agentic Economy
Track compliance.
