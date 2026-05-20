export type ProjectReleaseNote = {
  date: string
  detail: string
  tag: string
  title: string
}

export const projectTrailSummary = {
  buildLabel: 'Working build',
  headline: 'Case study first, report second, live operator only when needed.',
  lastReviewed: 'May 20, 2026',
}

export const projectReleaseNotes: ProjectReleaseNote[] = [
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
      'The site now has a dedicated notes surface for the current build, known gaps, and the most recent changes, instead of burying that context inside the dashboard.',
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
]

export const projectKnownGaps = [
  'Maintenance notes are browser-local until a shared backend is added.',
  'Live settlement still depends on the operator wallet on Arc Testnet.',
  'The report is strongest when live policy, Circle, and executor wiring are actually configured.',
]

export const projectReferenceLinks = [
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
