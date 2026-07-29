export type ProjectReleaseNote = {
  date: string
  detail: string
  tag: string
  title: string
}

export const projectTrailSummary = {
  buildLabel: 'Verified treasury reference build',
  headline:
    'A read-only Arc Testnet USDC treasury decision MVP with deterministic verification and an auditable evidence path.',
  lastReviewed: 'July 29, 2026',
}

export const projectReleaseNotes: ProjectReleaseNote[] = [
  {
    date: 'July 18, 2026',
    tag: 'security',
    title: 'Hardened every sensitive operator action',
    detail:
      'The submitted deployment hard-disables treasury writes and keeps the Arc/USDC decision path read-only.',
  },
  {
    date: 'July 18, 2026',
    tag: 'architecture',
    title: 'Added the reviewed V2 control path',
    detail:
      'The repository includes tested V2 policy and executor reference contracts, but the submitted deployment does not present them as live evidence.',
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
    tag: 'product',
    title: 'Refocused public pages on the product',
    detail:
      'The public surfaces now lead with treasury decisions, Arc/USDC evidence, verifiable controls, and deployment evidence.',
  },
  {
    date: 'June 2, 2026',
    tag: 'review',
    title: 'Added a system evidence page',
    detail:
      'The site now surfaces one architecture page with the production link, deployment ID and commit, Arc Testnet addresses, current proof status, and screenshot checklist.',
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
    title: 'Added a treasury operations brief page',
    detail:
      'The site now has a dedicated brief surface that explains the treasury policy workflow, what to inspect first, and where to verify the project.',
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
      'Visitors land on a report first and can inspect Arc/USDC signals without connecting a wallet or authorizing a transaction.',
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
      'The checker now emits read-only verification commands and JSON alongside the report.',
  },
  {
    date: 'May 20, 2026',
    tag: 'product',
    title: 'Removed public live-action claims',
    detail:
      'The submitted dashboard keeps treasury writes disabled and presents top-up or trim as review-only decisions.',
  },
]

export const projectKnownGaps = [
  'Maintenance notes are browser-local until a shared backend is added.',
  'The submitted public deployment is read-only; no treasury transaction is sent or claimed.',
  'The V2 contracts are tested reference code and are not presented as deployed evidence.',
  'Circle wallet-set readiness is shown as a dependency signal, not proof of custody or transfer.',
]

export const projectReferenceLinks = [
  {
    label: 'System architecture',
    value: '/architecture',
    href: '/architecture',
  },
  {
    label: 'Treasury operations brief',
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
