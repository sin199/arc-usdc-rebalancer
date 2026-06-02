export type ProjectReleaseNote = {
  date: string
  detail: string
  tag: string
  title: string
}

export const projectTrailSummary = {
  buildLabel: 'Verified Arc Testnet demo',
  headline:
    'Readiness checker first, operator brief second, optional live execution, with an architect proof page for Arc review.',
  lastReviewed: 'June 2, 2026',
}

export const projectReleaseNotes: ProjectReleaseNote[] = [
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
  'Live settlement still depends on the operator wallet on Arc Testnet.',
  'Circle wallet set is optional for the current proof and required only for live crosschain execution.',
  'The report is strongest when live policy, agent, executor, and proof links are visible together.',
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
