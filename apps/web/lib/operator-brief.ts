export const operatorBriefSummary = {
  headline:
    'A public treasury operations brief for this Arc Testnet USDC policy workflow.',
  reviewGoal:
    'Make it easy to verify the treasury policy workflow and see which pieces are intentionally public.',
  statusNote:
    'The product is a public Arc Testnet decision MVP; the submitted deployment is read-only and does not send treasury writes.',
}

export const operatorBriefEvidence = [
  {
    label: 'Live demo',
    value:
      'Public dashboard with report-first treasury flow and a hard read-only boundary.',
  },
  {
    label: 'Arc surface',
    value:
      'Arc Testnet policy, executor, onchain identity evidence, and readiness checks in one flow.',
  },
  {
    label: 'Treasury workflow',
    value:
      'Policy evaluation, brief generation, action pack, and execution trail in one flow.',
  },
  {
    label: 'Circle surface',
    value:
      'Developer-controlled wallets and Gateway readiness kept visible in the same stack.',
  },
  {
    label: 'Execution',
    value:
      'Treasury writes are not part of the submitted deployment; execution status is disabled.',
  },
]

export const operatorBriefChecklist = [
  'Open the dashboard and generate a readiness report from the live balance and policy inputs.',
  'Open the case study to see the short replay path and what to inspect first.',
  'Open the notes page to read the maintenance trail and known gaps.',
  'Use the repo and the live deployment as the evidence trail for the policy workflow.',
]

export const operatorBriefActions = [
  {
    label: 'Dashboard',
    href: '/dashboard',
    detail: 'Generate the report and inspect the action pack.',
  },
  {
    label: 'Case study',
    href: '/case-study',
    detail: 'Read the replay path and review checklist.',
  },
  {
    label: 'Release notes',
    href: '/notes',
    detail: 'Read the maintenance trail and known gaps.',
  },
  {
    label: 'GitHub repo',
    href: 'https://github.com/sin199/arc-usdc-rebalancer',
    detail: 'Inspect the source and commit trail.',
  },
]
