import { evaluatePolicy, formatUsdc, type TreasuryPolicy } from '@arc-usdc-rebalancer/shared'

export type ReadinessReportInputs = {
  agentId: string
  agentTag: string
  balance: number
  circleNotes: string[]
  circleReady: boolean
  circleSummary: string
  contractAddress?: string
  executorAddress?: string
  generatedAt: string
  liveMode: boolean
  modeLabel: string
  policy: TreasuryPolicy
  policySourceLabel: string
  walletSetId?: string
}

export type ReadinessReportCheck = {
  detail: string
  label: string
  passed: boolean
}

export type ReadinessReportEvidence = {
  label: string
  value: string
}

export type ReadinessReport = {
  action: 'hold' | 'top_up' | 'trim' | 'review'
  confidence: number
  evidence: ReadinessReportEvidence[]
  headline: string
  markdown: string
  nextSteps: string[]
  summary: string
  checks: ReadinessReportCheck[]
}

function formatPolicyBand(policy: TreasuryPolicy) {
  return `${formatUsdc(policy.minThreshold)} / ${formatUsdc(policy.targetBalance)} / ${formatUsdc(
    policy.maxRebalanceAmount,
  )} USDC`
}

function formatAction(evaluationAction: 'hold' | 'top_up' | 'trim') {
  if (evaluationAction === 'top_up') {
    return 'Top up'
  }

  if (evaluationAction === 'trim') {
    return 'Trim'
  }

  return 'Hold'
}

function formatMarkdown(report: ReadinessReport, inputs: ReadinessReportInputs, evaluationMessage: string) {
  const lines = [
    '# Arc USDC Rebalancer readiness report',
    '',
    `Generated: ${new Date(inputs.generatedAt).toLocaleString('en-US')}`,
    `Mode: ${inputs.modeLabel}`,
    `Decision: ${report.action === 'review' ? 'Review' : formatAction(report.action)}`,
    `Confidence: ${(report.confidence * 100).toFixed(0)}%`,
    '',
    '## Summary',
    report.summary,
    '',
    '## Evidence',
    ...report.evidence.map((item) => `- ${item.label}: ${item.value}`),
    '',
    '## Next steps',
    ...report.nextSteps.map((step) => `- ${step}`),
    '',
    '## Health checks',
    ...report.checks.map((check) => `- ${check.passed ? 'PASS' : 'WARN'} ${check.label}: ${check.detail}`),
    '',
    '## Policy note',
    evaluationMessage,
  ]

  return lines.join('\n')
}

export function buildReadinessReport(inputs: ReadinessReportInputs): ReadinessReport {
  const evaluation = evaluatePolicy(inputs.balance, inputs.policy)
  const policyBand = formatPolicyBand(inputs.policy)
  const liveDependenciesReady = inputs.liveMode && inputs.circleReady && Boolean(inputs.executorAddress)
  const reportAction: ReadinessReport['action'] =
    !inputs.contractAddress && inputs.liveMode
      ? 'review'
      : !inputs.circleReady && inputs.liveMode
        ? 'review'
        : !inputs.executorAddress && inputs.liveMode
          ? 'review'
          : evaluation.action === 'top_up'
            ? 'top_up'
            : evaluation.action === 'trim'
              ? 'trim'
              : 'hold'

  const summary =
    reportAction === 'hold'
      ? `Treasury is inside the band at ${formatUsdc(inputs.balance)} USDC. Hold and keep monitoring.`
      : reportAction === 'top_up'
        ? `${evaluation.message} The report recommends adding ${formatUsdc(evaluation.amount)} USDC.`
        : reportAction === 'trim'
          ? `${evaluation.message} The report recommends trimming ${formatUsdc(evaluation.amount)} USDC.`
          : 'One or more live dependencies are missing, so the report stays in review mode.'

  const headline =
    reportAction === 'hold'
      ? 'Treasury is inside the policy band.'
      : reportAction === 'top_up'
        ? `Top up ${formatUsdc(evaluation.amount)} USDC to move back toward target.`
        : reportAction === 'trim'
          ? `Trim ${formatUsdc(evaluation.amount)} USDC to reduce excess above target.`
          : 'Review the live dependencies before moving funds.'

  const nextSteps: string[] = []

  if (!inputs.contractAddress) {
    nextSteps.push('Set TREASURY_POLICY_ADDRESS if you want a live onchain policy snapshot. Preview mode still works.')
  } else if (inputs.policySourceLabel === 'Draft policy') {
    nextSteps.push('Load the onchain policy before relying on the report for live execution.')
  }

  if (!inputs.circleReady) {
    nextSteps.push('Finish Circle readiness so wallet and gateway reads are available.')
  }

  if (!inputs.executorAddress) {
    nextSteps.push('Deploy or set the TreasuryExecutor address before live execution.')
  }

  if (reportAction === 'hold') {
    nextSteps.push('Keep monitoring and share the report if you need a review trail.')
  } else if (reportAction === 'review') {
    nextSteps.push('Resolve the missing dependency, then regenerate the report.')
  } else {
    nextSteps.push(`Confirm the ${reportAction === 'top_up' ? 'top-up' : 'trim'} amount and execute only if the live operator is ready.`)
  }

  const evidence: ReadinessReportEvidence[] = [
    { label: 'Policy band', value: policyBand },
    { label: 'Current balance', value: `${formatUsdc(inputs.balance)} USDC` },
    { label: 'Policy source', value: inputs.policySourceLabel },
    { label: 'Circle', value: inputs.circleSummary },
    { label: 'Circle notes', value: inputs.circleNotes.length > 0 ? `${inputs.circleNotes.length} note(s)` : 'No notes' },
    { label: 'Wallet set', value: inputs.walletSetId ?? 'Missing' },
    { label: 'Executor', value: inputs.executorAddress ? inputs.executorAddress : 'Missing' },
    { label: 'Agent', value: `#${inputs.agentId} · ${inputs.agentTag}` },
  ]

  const checks: ReadinessReportCheck[] = [
    {
      label: 'Policy loaded',
      passed: Boolean(inputs.contractAddress) || inputs.policySourceLabel === 'Draft policy',
      detail: inputs.contractAddress
        ? 'Onchain policy address is configured.'
        : 'Draft policy preview is being used.',
    },
    {
      label: 'Circle ready',
      passed: inputs.circleReady,
      detail: inputs.circleReady ? 'Circle control plane readiness is complete.' : 'Circle still needs attention.',
    },
    {
      label: 'Executor ready',
      passed: Boolean(inputs.executorAddress),
      detail: inputs.executorAddress ? 'TreasuryExecutor is configured.' : 'TreasuryExecutor is missing.',
    },
    {
      label: 'Live mode',
      passed: inputs.liveMode ? liveDependenciesReady : true,
      detail: inputs.liveMode
        ? 'The live path can be used once the missing dependencies are in place.'
        : 'Demo mode keeps the report useful without a wallet.',
    },
  ]

  const report: ReadinessReport = {
    action: reportAction,
    confidence:
      reportAction === 'hold'
        ? liveDependenciesReady
          ? 0.97
          : 0.92
        : reportAction === 'review'
          ? 0.56
          : liveDependenciesReady
            ? 0.87
            : 0.64,
    evidence,
    headline,
    nextSteps,
    summary,
    checks,
    markdown: '',
  }

  report.markdown = formatMarkdown(report, inputs, evaluation.message)
  return report
}
