export type ProjectReleaseNote = {
  date: string
  detail: string
  tag: string
  title: string
}

export const projectTrailSummary = {
  buildLabel: 'Official Architect reference build',
  headline:
    'A fail-closed Arc treasury reference stack with signed operator actions, deterministic verification, and an auditable V2 governance path.',
  lastReviewed: 'July 18, 2026',
}

export const projectReleaseNotes: ProjectReleaseNote[] = [
  {
    date: 'July 18, 2026',
    tag: 'security',
    title: 'Hardened every sensitive operator action',
    detail:
      'Treasury execution, agent activation, executor deployment, and Circle wallet creation now require payload-bound wallet authorization. Production writes fail closed unless a durable replay and rate-limit store is available.',
  },
  {
    date: 'July 18, 2026',
    tag: 'architecture',
    title: 'Added the reviewed V2 control path',
    detail:
      'The repository now includes tested, undeployed V2 policy and executor contracts with two-step ownership, pause, recipient allowlists, amount caps, eligibility checks, transfer wrappers, and reentrancy protection.',
  },
  {
    date: 'July 18, 2026',
    tag: 'verification',
    title: 'Made the complete test path deterministic',
    detail:
      'Web authorization, worker policy behavior, and contract governance now run without depending on a rate-limited public RPC, while production readiness exposes the durable guard state explicitly.',
  },
  {
    date: 'July 18, 2026',
    tag: 'identity',
    title: 'Published the Official Arc Architect positioning',
    detail:
      'The public surfaces now identify the builder as an Official Arc Architect while clearly describing this repository as an independent community project rather than an official Arc product.',
  },
  {
    date: 'June 2, 2026',
    tag: 'review',
    title: 'Added an architect proof page',
    detail:
      'The site now surfaces one proof page with the production link, deployment hash, Arc Testnet addresses, current proof status, and screenshot checklist.',
  },
  {
    date: 'May 31, 2026',
    tag: 'product',
    title: 'Surfaced a recent change trail on the homepage',
    detail:
      'The homepage now shows a compact, visible release trail so reviewers can see what changed without opening the notes page.',
  },
  {
    date: 'May 20, 2026',
    tag: 'review',
    title: 'Added an operator brief page',
    detail:
      'The site now has a dedicated brief surface that explains what the robot does, what to inspect first, and where to verify the project.',
  },
  {
    date: 'May 20, 2026',
    tag: 'product',
    title: 'Reframed the dashboard as a readiness checker',
    detail:
      'The main route now produces a copyable treasury report instead of expecting visitors to assemble the state from several panels.',
  },
  {
    date: 'May 20, 2026',
    tag: 'maintenance',
    title: 'Added an editable maintenance log',
    detail:
      'The dashboard now keeps a browser-local scratchpad so updates, blockers, and follow-up notes are written down while the project is being iterated.',
  },
  {
    date: 'May 20, 2026',
    tag: 'navigation',
    title: 'Added a release notes page',
    detail:
      'The site now has a dedicated notes surface for the current demo, known gaps, and the most recent changes, instead of burying that context inside the dashboard.',
  },
  {
    date: 'May 20, 2026',
    tag: 'flow',
    title: 'Kept the report path explicit',
    detail:
      'Visitors still land on a report first, with live signing, agent control, and Circle/Arc actions available only when they are intentionally needed.',
  },
  {
    date: 'May 20, 2026',
    tag: 'documentation',
    title: 'Added a case study page',
    detail:
      'A short public page now explains what the repo proves, how to replay it locally, and what a reviewer should inspect first.',
  },
  {
    date: 'May 20, 2026',
    tag: 'product',
    title: 'Added a copyable action pack',
    detail:
      'The checker now emits command lines and JSON that an operator can actually use instead of only reading the report.',
  },
  {
    date: 'May 20, 2026',
    tag: 'product',
    title: 'Added a live action button',
    detail:
      'The dashboard can now submit the server-signer execution path directly when the report calls for top-up or trim.',
  },
]

export const projectKnownGaps = [
  'Maintenance notes are browser-local until a shared backend is added.',
  'Production live execution remains disabled until durable Upstash Redis replay protection is provisioned and verified.',
  'The V2 contracts are tested reference code; deployment, multisig ownership, and migration remain pending formal review.',
  'Any future live settlement still depends on an explicitly authorized operator wallet on Arc Testnet.',
  'Circle wallet set is optional for the current proof and required only for live crosschain execution.',
]

export const projectReferenceLinks = [
  {
    label: 'Architect proof',
    value: '/architects',
    href: '/architects',
  },
  {
    label: 'Operator brief',
    value: '/operator',
    href: '/operator',
  },
  {
    label: 'Case study',
    value: '/case-study',
    href: '/case-study',
  },
  {
    label: 'Live checker',
    value: 'web-eight-chi-99.vercel.app/dashboard',
    href: 'https://web-eight-chi-99.vercel.app/dashboard',
  },
  {
    label: 'GitHub repo',
    value: 'sin199/arc-usdc-rebalancer',
    href: 'https://github.com/sin199/arc-usdc-rebalancer',
  },
  {
    label: 'Release notes',
    value: '/notes',
    href: '/notes',
  },
]
