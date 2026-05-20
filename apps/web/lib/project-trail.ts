export type ProjectReleaseNote = {
  date: string
  detail: string
  tag: string
  title: string
}

export const projectTrailSummary = {
  buildLabel: 'Working build',
  headline: 'Public demo first, live operator second, notes always visible.',
  lastReviewed: 'May 20, 2026',
}

export const projectReleaseNotes: ProjectReleaseNote[] = [
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
      'The site now has a dedicated notes surface for the current build, known gaps, and the most recent changes, instead of burying that context inside the dashboard.',
  },
  {
    date: 'May 20, 2026',
    tag: 'flow',
    title: 'Kept the demo path explicit',
    detail:
      'Visitors still land on a public demo first, with live signing, agent control, and Circle/Arc actions available only when they are intentionally needed.',
  },
]

export const projectKnownGaps = [
  'Maintenance notes are browser-local until a shared backend is added.',
  'Live settlement still depends on the operator wallet on Arc Testnet.',
  'Some Circle wallet and bridge work remains intentionally surfaced as readiness, not silent automation.',
]

export const projectReferenceLinks = [
  {
    label: 'Live demo',
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
