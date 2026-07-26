# Arc USDC Rebalancer security model

## Position

This repository is a public Arc Testnet treasury reference implementation, not a production custody service. Its controls and deployment evidence must stand on their own, independent of the builder's title.

## Trust boundaries

1. Public visitors may simulate policy states and export reports without a wallet.
2. Operators must be explicitly allowlisted and sign a short-lived, origin-bound request.
3. Server signer routes are hard-disabled while the reviewed V2 execution path is not wired; no environment flag can enable the legacy Executor.
4. Arc Agent activation, Circle wallet creation, executor deployment, and treasury execution share the same authorization boundary.
5. Redis request reservations provide cross-instance replay prevention and rate limiting. Production never falls back to process memory.
6. Server-side secrets are never returned to the browser and are initialized only inside server code paths.

## Current production gate

`ENABLE_LIVE_EXECUTION` stays `false`, and the code-level gate also requires the reviewed V2 execution path. Enabling it is not permitted for the current legacy Executor path. A future enablement review would require all of these:

- Upstash Redis credentials are provisioned through Vercel Marketplace.
- The operator wallet allowlist and allowed origins are reviewed.
- Unauthorized, expired, replayed, oversized, and rate-limited requests pass integration tests.
- The owner key has a rotation and recovery plan.
- A V2 ownership/multisig migration is approved.

The Worker mutation API separately requires `WORKER_API_TOKEN`, rejects unconfigured cross-origin requests, limits JSON body size, and binds the standalone listener to `127.0.0.1`.

## V2 contract controls

The V2 reference contracts are intentionally not wired to the current deployment yet. They add:

- two-step ownership transfer for safe multisig migration;
- executor pause and explicit recipient allowlisting;
- an executor cap combined with the policy cap;
- onchain enforcement that top-ups only happen below the minimum and trims only happen above target;
- transfer wrappers and a reentrancy guard.

Deploying V2 is a separate, reviewed chain-state change. The existing contracts and balances must not be migrated implicitly by a frontend release.

## Decision receipt anchor

`TreasuryDecisionReceipt` is an optional, un-deployed registry for immutable decision hashes. A hash binds the Arc chain, policy source and values, observed balance, proposed action, amount, policy and executor addresses, and observation time. Recording a receipt does not custody USDC or invoke the executor. Its deployment and every record write remain separate, reviewed Arc Testnet actions; the public dashboard must show `not published` until a transaction hash exists.

## Verification expectations

- Web and worker type checks pass.
- Web authorization tests and worker lifecycle tests pass without public RPC access.
- Foundry covers both the current contracts and V2 safety controls.
- Production status exposes the guard mode without exposing credentials.
- Production mutation routes reject unauthenticated requests while live execution remains disabled.
