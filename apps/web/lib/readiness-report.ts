import {
  arcTestnetRpcUrl,
  arcUsdcAddress,
  evaluatePolicy,
  formatUsdc,
  type TreasuryPolicy,
} from '@arc-usdc-rebalancer/shared'
import { parseUsdcAmount } from './usdc-amount'

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
  liveExecutionEnabled: boolean
  liveMode: boolean
  modeLabel: string
  policy: TreasuryPolicy
  policySourceLabel: string
  operatorAddress?: string
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

export type ReadinessCommand = {
  label: string
  command: string
}

export type ReadinessActionPack = {
  actionable: boolean
  amountUnits: string
  commands: ReadinessCommand[]
  payload: Record<string, string | number | null>
  summary: string
}

export type ReadinessReport = {
  action: 'hold' | 'top_up' | 'trim' | 'review'
  actionPack: ReadinessActionPack
  decisionBasis: string
  evidence: ReadinessReportEvidence[]
  headline: string
  markdown: string
  nextSteps: string[]
  readiness: {
    passed: number
    total: number
  }
  summary: string
  checks: ReadinessReportCheck[]
}

const editableScenarioBalanceSource =
  'Editable scenario input; not the live executor balance shown in the Treasury Brief.'

function formatPolicyBand(policy: TreasuryPolicy) {
  return `${formatUsdc(policy.minThreshold)} / ${formatUsdc(policy.targetBalance)} / ${formatUsdc(policy.maxRebalanceAmount)} USDC`
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

function buildActionPack(
  reportAction: ReadinessReport['action'],
  inputs: ReadinessReportInputs,
  amountUsdc: number,
): ReadinessActionPack {
  const amountUnits = parseUsdcAmount(
    amountUsdc,
    'USDC amount',
    true,
  ).amountUnits.toString()
  const executorAddress =
    inputs.executorAddress ?? '<TREASURY_EXECUTOR_ADDRESS>'
  const operatorAddress = inputs.operatorAddress ?? '<RECIPIENT_WALLET_ADDRESS>'
  const executorFallbackNote = inputs.executorAddress
    ? ''
    : ' Configure TREASURY_EXECUTOR_ADDRESS before attempting live execution.'

  if (reportAction === 'top_up' && amountUsdc > 0) {
    return {
      actionable: true,
      amountUnits,
      commands: [
        {
          label: 'Approve USDC',
          command: `cast send ${arcUsdcAddress} "approve(address,uint256)" ${executorAddress} ${amountUnits} --rpc-url ${arcTestnetRpcUrl} --private-key $OWNER_PRIVATE_KEY`,
        },
        {
          label: 'Execute top-up',
          command: `cast send ${executorAddress} "executeTopUp(uint256)" ${amountUnits} --rpc-url ${arcTestnetRpcUrl} --private-key $OWNER_PRIVATE_KEY`,
        },
      ],
      payload: {
        action: 'top_up',
        amountUsdc,
        amountUnits,
        chainId: 5042002,
        executorAddress: inputs.executorAddress ?? null,
        operatorAddress: inputs.operatorAddress ?? null,
        rpcUrl: arcTestnetRpcUrl,
        tokenAddress: arcUsdcAddress,
      },
      summary: `Approve USDC to the executor, then submit the top-up transaction.${executorFallbackNote}`,
    }
  }

  if (reportAction === 'trim' && amountUsdc > 0) {
    return {
      actionable: true,
      amountUnits,
      commands: [
        {
          label: 'Execute trim',
          command: `cast send ${executorAddress} "executeTrim(address,uint256)" ${operatorAddress} ${amountUnits} --rpc-url ${arcTestnetRpcUrl} --private-key $OWNER_PRIVATE_KEY`,
        },
      ],
      payload: {
        action: 'trim',
        amountUsdc,
        amountUnits,
        chainId: 5042002,
        executorAddress: inputs.executorAddress ?? null,
        operatorAddress: inputs.operatorAddress ?? null,
        recipientAddress: inputs.operatorAddress ?? null,
        rpcUrl: arcTestnetRpcUrl,
        tokenAddress: arcUsdcAddress,
      },
      summary: `Send the trim directly back to the connected operator wallet.${executorFallbackNote}`,
    }
  }

  return {
    actionable: false,
    amountUnits,
    commands: [],
    payload: {
      action: reportAction,
      amountUsdc,
      amountUnits,
      chainId: 5042002,
      executorAddress: inputs.executorAddress ?? null,
      operatorAddress: inputs.operatorAddress ?? null,
      rpcUrl: arcTestnetRpcUrl,
      tokenAddress: arcUsdcAddress,
    },
    summary:
      reportAction === 'hold'
        ? 'No chain transaction is needed. Keep monitoring and share the report.'
        : 'Resolve the missing dependencies before preparing an execution command.',
  }
}

function formatMarkdown(
  report: ReadinessReport,
  inputs: ReadinessReportInputs,
  evaluationMessage: string,
) {
  const lines = [
    '# Arc USDC Rebalancer readiness report',
    '',
    `Generated: ${new Date(inputs.generatedAt).toLocaleString('en-US')}`,
    `Mode: ${inputs.modeLabel}`,
    `Decision: ${report.action === 'review' ? 'Review' : formatAction(report.action)}`,
    `Decision basis: ${report.decisionBasis}`,
    `Balance source: ${editableScenarioBalanceSource}`,
    `Execution readiness: ${report.readiness.passed}/${report.readiness.total} checks passed`,
    '',
    '## Summary',
    report.summary,
    '',
    '## Evidence',
    ...report.evidence.map((item) => `- ${item.label}: ${item.value}`),
    '',
    '## Action pack',
    report.actionPack.summary,
    ...(report.actionPack.commands.length > 0
      ? [
          '',
          '### Commands',
          ...report.actionPack.commands.map(
            (command) => `- ${command.label}: ${command.command}`,
          ),
        ]
      : []),
    '',
    '## Next steps',
    ...report.nextSteps.map((step) => `- ${step}`),
    '',
    '## Health checks',
    ...report.checks.map(
      (check) =>
        `- ${check.passed ? 'PASS' : 'WARN'} ${check.label}: ${check.detail}`,
    ),
    '',
    '## Policy note',
    evaluationMessage,
  ]

  return lines.join('\n')
}

export function buildReadinessReport(
  inputs: ReadinessReportInputs,
): ReadinessReport {
  const evaluation = evaluatePolicy(inputs.balance, inputs.policy)
  const policyBand = formatPolicyBand(inputs.policy)
  const policyLoaded =
    inputs.policySourceLabel === 'Live chain snapshot' &&
    Boolean(inputs.contractAddress)
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

  const targetDistance = Math.abs(inputs.balance - inputs.policy.targetBalance)
  const decisionBasis =
    reportAction === 'top_up'
      ? `${formatUsdc(inputs.policy.minThreshold - inputs.balance)} USDC below the minimum threshold.`
      : reportAction === 'trim'
        ? `${formatUsdc(inputs.balance - inputs.policy.targetBalance)} USDC above the target balance.`
        : reportAction === 'hold'
          ? `Inside the policy band; ${formatUsdc(targetDistance)} USDC from target.`
          : 'One or more required execution dependencies are missing.'

  const nextSteps: string[] = []

  if (!inputs.contractAddress) {
    nextSteps.push(
      'Set TREASURY_POLICY_ADDRESS if you want a live onchain policy snapshot. Preview mode still works.',
    )
  } else if (inputs.policySourceLabel === 'Draft policy') {
    nextSteps.push(
      'Load the onchain policy before relying on the report for live execution.',
    )
  }

  if (!inputs.circleReady) {
    nextSteps.push(
      'Finish Circle readiness so wallet and gateway reads are available.',
    )
  }

  if (!inputs.executorAddress) {
    nextSteps.push(
      'Deploy TreasuryExecutor through the explicit operator flow, then set TREASURY_EXECUTOR_ADDRESS.',
    )
  }

  if (reportAction === 'hold') {
    nextSteps.push(
      'Keep monitoring and share the report if you need a review trail.',
    )
  } else if (reportAction === 'review') {
    nextSteps.push(
      'Resolve the missing dependency, then regenerate the report.',
    )
  } else {
    nextSteps.push(
      `Confirm the ${reportAction === 'top_up' ? 'top-up' : 'trim'} amount and execute only if the live operator is ready.`,
    )
  }

  const evidence: ReadinessReportEvidence[] = [
    { label: 'Policy band', value: policyBand },
    { label: 'Scenario balance', value: `${formatUsdc(inputs.balance)} USDC` },
    { label: 'Balance source', value: editableScenarioBalanceSource },
    { label: 'Policy source', value: inputs.policySourceLabel },
    { label: 'Circle', value: inputs.circleSummary },
    {
      label: 'Circle notes',
      value:
        inputs.circleNotes.length > 0
          ? `${inputs.circleNotes.length} note(s)`
          : 'No notes',
    },
    { label: 'Wallet set', value: inputs.walletSetId ?? 'Missing' },
    {
      label: 'Executor',
      value: inputs.executorAddress ? inputs.executorAddress : 'Missing',
    },
    {
      label: 'Server execution',
      value: inputs.liveExecutionEnabled
        ? 'Enabled with wallet authorization'
        : 'Disabled',
    },
    { label: 'Agent', value: `#${inputs.agentId} · ${inputs.agentTag}` },
  ]

  const checks: ReadinessReportCheck[] = [
    {
      label: 'Policy source',
      passed: policyLoaded,
      detail: policyLoaded
        ? 'Onchain policy snapshot is configured and loaded.'
        : inputs.contractAddress
          ? 'Draft policy preview is active; load the onchain snapshot before live execution.'
          : 'Draft policy preview is active because no policy address is configured yet.',
    },
    {
      label: 'Circle ready',
      passed: inputs.circleReady,
      detail: inputs.circleReady
        ? 'Circle control plane readiness is complete.'
        : 'Circle still needs attention.',
    },
    {
      label: 'Executor ready',
      passed: Boolean(inputs.executorAddress),
      detail: inputs.executorAddress
        ? 'TreasuryExecutor is configured.'
        : 'TreasuryExecutor is missing.',
    },
    {
      label: 'Server execution',
      passed: inputs.liveExecutionEnabled,
      detail: inputs.liveExecutionEnabled
        ? 'Live writes require an allowlisted operator wallet signature.'
        : 'Live writes are disabled; preview and report export remain available.',
    },
  ]

  const readiness = {
    passed: checks.filter((check) => check.passed).length,
    total: checks.length,
  }

  const report: ReadinessReport = {
    action: reportAction,
    actionPack: buildActionPack(reportAction, inputs, evaluation.amount),
    decisionBasis,
    evidence,
    headline,
    nextSteps,
    readiness,
    summary,
    checks,
    markdown: '',
  }

  report.markdown = formatMarkdown(report, inputs, evaluation.message)
  return report
}
