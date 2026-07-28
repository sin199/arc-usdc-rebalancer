# Final Submission Pack

## Official requirements

Encode Club's Final Submission is due Sunday, 9 August 2026, Anywhere on
Earth (UTC-12). The required deliverables are:

- a functional MVP;
- a three-minute pitch and demo covering what was built, how it works, the
  selected track, and the core products used;
- a presentation deck;
- a public code repository.

Submit this project to the **DeFi Track only**.

## Final description

Arc USDC Rebalancer is a deployed Arc Testnet DeFi Treasury MVP. It reads the
live TreasuryPolicy and executor USDC balance, checks Arc-linked validation and
Circle developer-controlled Wallets and Gateway readiness, evaluates a bounded
`top_up`, `hold`, or `trim` decision, and exports an auditable markdown report
and action pack.

The public deployment is intentionally read-only. It reports
`enabled: false`, exposes no wallet connection or signed execution path, sends
no treasury transaction, and marks exported decision receipts as
`not published`.

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

1. Identify the DeFi Track and the Arc, USDC, Circle Wallets, and Gateway
   stack.
2. Show the live Arc policy, executor balance, source quality, and Circle
   readiness.
3. Compare the below-minimum, at-target, and above-target outcomes.
4. Show the exported action pack and execution lock.
5. Show Arc chain ID `5042002`, the deployed policy and executor addresses,
   and the reproducible case study.
6. Close with the exact boundary: the MVP prepares a reviewable action and
   does not claim a completed treasury transfer.

The video is exactly 180 seconds at 1280x720, with H.264 video and AAC audio.
Its visuals were rebuilt from the current read-only production interface on
28 July 2026.

## Reviewer-verifiable facts

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

The dated read-only capture is in
[`arc-testnet-evidence.json`](./arc-testnet-evidence.json). It contains no
private key, wallet credential, or fabricated transaction hash.

## Submission gate

**Go** only when the Final Submission form is open and all six public links
above return successfully.

**No-go** for any form text, video narration, or deck copy that claims live
treasury movement, autonomous custody, a confirmed Arc transaction, or
Agentic Economy Track compliance.
