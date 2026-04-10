import type { Address } from 'viem'
import { formatUsdc, type TreasuryPolicy } from './policy'

export type RobotExecutionMode = 'dry-run' | 'manual-approve' | 'auto'

export type TreasuryJobType =
  | 'rebalance'
  | 'wallet-top-up'
  | 'payout-batch'
  | 'treasury-sweep'
  | 'bridge-top-up'
  | 'invoice-settlement'

export type TreasuryJobStatus =
  | 'created'
  | 'planned'
  | 'awaiting-approval'
  | 'approved'
  | 'rejected'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'cancelled'

export type TreasuryJobTrigger = 'schedule' | 'manual' | 'approval' | 'startup'

export type TreasuryJobActor = 'robot' | 'operator' | 'executor' | 'system'

export type TreasuryJobRiskLevel = 'pass' | 'warn' | 'block'

export type TreasuryJobRecipient = {
  address: Address
  amountUsdc: number
  label?: string
}

export type RobotSafetyConfig = {
  globalPaused: boolean
  policyPaused: boolean
  emergencyStop: boolean
  maxExecutionAmountUsdc: number
  dailyNotionalCapUsdc: number
  cooldownMinutes: number
  destinationAllowlist: Address[]
  rebalanceDestinationAddress?: Address
  bridgeTopUpEnabled: boolean
}

export type RobotAvailability = {
  circleExecutorAvailable: boolean
  bridgeProviderAvailable: boolean
  autoEnabled: boolean
  missingEnvVars: string[]
}

export type TreasurySnapshot = {
  policyAddress: Address
  treasuryAddress: Address
  policy: TreasuryPolicy
  treasuryBalanceUsdc: number
  balanceSource: 'chain' | 'override'
  balanceUpdatedAt: string
  payoutRecipients: TreasuryJobRecipient[]
  lastJobAt?: string
}

export type RobotStatus = 'ready' | 'working' | 'paused' | 'blocked'

export type RobotIdentity = {
  name: string
  supportedJobTypes: TreasuryJobType[]
  currentMode: RobotExecutionMode
  currentStatus: RobotStatus
  onchainAgentIdentity?: string
}

export type TreasuryJobRiskCheck = {
  code: string
  label: string
  level: TreasuryJobRiskLevel
  detail: string
}

export type TreasuryJobParameters = {
  amountUsdc: number
  currentBalanceUsdc?: number
  minThresholdUsdc?: number
  targetBalanceUsdc?: number
  destinationAddress?: Address
  destinationLabel?: string
  direction?: 'top-up' | 'sweep'
  recipients?: TreasuryJobRecipient[]
  invoiceId?: string
  memo?: string
  sourceChain?: string
  destinationChain?: string
  bridgeEnabled?: boolean
}

export type TreasuryJobRequestedAction = {
  summary: string
  triggerSource: TreasuryJobTrigger
  rationale: string
}

export type TreasuryJobTimelineEvent = {
  status: TreasuryJobStatus
  at: string
  actor: TreasuryJobActor
  message: string
}

export type TreasuryJobRecord = {
  id: string
  type: TreasuryJobType
  amountUsdc: number
  requestedAction: TreasuryJobRequestedAction
  parameters: TreasuryJobParameters
  riskChecks: TreasuryJobRiskCheck[]
  executionMode: RobotExecutionMode
  status: TreasuryJobStatus
  approvalRequired: boolean
  approvalReason: string
  createdAt: string
  updatedAt: string
  policyAddress: Address
  treasuryAddress: Address
  balanceUsdc: number
  policyMinThresholdUsdc: number
  policyTargetBalanceUsdc: number
  policyMaxRebalanceAmountUsdc: number
  txHash?: string
  txUrl?: string
  result?: string
  failureReason?: string
  executor: {
    name: 'local' | 'circle' | 'bridge' | 'none'
    enabled: boolean
    txHash?: string
    txUrl?: string
    error?: string
  }
  triggerSource: TreasuryJobTrigger
  logs: string[]
  timeline: TreasuryJobTimelineEvent[]
}

export type RobotRuntimeState = {
  version: 2
  robot: RobotIdentity
  mode: RobotExecutionMode
  safety: RobotSafetyConfig
  availability: RobotAvailability
  snapshot: TreasurySnapshot | null
  jobs: TreasuryJobRecord[]
  lastTickAt?: string
  lastError?: string
}

export type TreasuryJobCandidate = {
  type: TreasuryJobType
  requestedAction: TreasuryJobRequestedAction
  parameters: TreasuryJobParameters
  riskChecks: TreasuryJobRiskCheck[]
  reason: string
  reasonCodes: string[]
  amountUsdc: number
  destinationAddress?: Address
  destinationLabel?: string
  recipients?: TreasuryJobRecipient[]
}

export type TreasuryJobPlanInput = {
  now: Date
  snapshot: TreasurySnapshot
  safety: RobotSafetyConfig
  availability: RobotAvailability
  jobs: TreasuryJobRecord[]
  triggerSource: TreasuryJobTrigger
  mode: RobotExecutionMode
}

export type RobotSafetyEvaluation = {
  allowed: boolean
  blockers: string[]
  dailySpentUsdc: number
  dailyRemainingUsdc: number
  cooldownRemainingMinutes: number
  destinationAllowlist: Address[]
}

export type TreasuryJobPlanResult = {
  candidate: TreasuryJobCandidate | null
  safety: RobotSafetyEvaluation
  blockers: string[]
}

export const SUPPORTED_JOB_TYPES: TreasuryJobType[] = [
  'rebalance',
  'wallet-top-up',
  'payout-batch',
  'treasury-sweep',
  'bridge-top-up',
  'invoice-settlement',
]

const COUNTED_JOB_STATUSES = new Set<TreasuryJobStatus>(['submitted', 'confirmed'])
const PENDING_JOB_STATUSES = new Set<TreasuryJobStatus>([
  'created',
  'planned',
  'awaiting-approval',
  'approved',
  'submitted',
])

function isAllowlistedDestination(destination: Address | undefined, allowlist: Address[]) {
  if (!destination) {
    return false
  }

  return allowlist.some((allowed) => allowed.toLowerCase() === destination.toLowerCase())
}

function recipientSum(recipients: TreasuryJobRecipient[]) {
  return recipients.reduce((total, recipient) => total + recipient.amountUsdc, 0)
}

function buildRiskCheck(code: string, label: string, level: TreasuryJobRiskLevel, detail: string): TreasuryJobRiskCheck {
  return { code, label, level, detail }
}

function buildModeRiskCheck(mode: RobotExecutionMode, availability: RobotAvailability) {
  if (mode === 'dry-run') {
    return buildRiskCheck(
      'MODE_GATE',
      'Execution mode',
      'warn',
      'Dry-run mode records the treasury job without submitting a transaction.',
    )
  }

  if (mode === 'manual-approve') {
    return buildRiskCheck(
      'MODE_GATE',
      'Execution mode',
      'warn',
      'Manual approval is required before this treasury job can be submitted.',
    )
  }

  return buildRiskCheck(
    'MODE_GATE',
    'Execution mode',
    availability.autoEnabled ? 'pass' : 'block',
    availability.autoEnabled
      ? 'Auto execution is enabled for this robot.'
      : 'Auto execution remains disabled until the executor credentials are available.',
  )
}

function buildCommonRiskChecks(
  mode: RobotExecutionMode,
  safety: RobotSafetyConfig,
  availability: RobotAvailability,
  candidate: TreasuryJobCandidate,
): TreasuryJobRiskCheck[] {
  const checks: TreasuryJobRiskCheck[] = [
    buildRiskCheck(
      'GLOBAL_PAUSE',
      'Global pause',
      safety.globalPaused ? 'block' : 'pass',
      safety.globalPaused ? 'Global pause is engaged.' : 'Global pause is clear.',
    ),
    buildRiskCheck(
      'POLICY_PAUSE',
      'Policy pause',
      safety.policyPaused ? 'block' : 'pass',
      safety.policyPaused ? 'The active policy is paused.' : 'Policy execution is active.',
    ),
    buildRiskCheck(
      'EMERGENCY_STOP',
      'Emergency stop',
      safety.emergencyStop ? 'block' : 'pass',
      safety.emergencyStop ? 'Emergency stop is engaged.' : 'Emergency stop is clear.',
    ),
    buildRiskCheck(
      'DAILY_NOTIONAL_CAP',
      'Daily notional cap',
      candidate.amountUsdc <= safety.dailyNotionalCapUsdc ? 'pass' : 'block',
      `Remaining cap for the day is ${formatUsdc(safety.dailyNotionalCapUsdc)} USDC before spending.`,
    ),
    buildRiskCheck(
      'MAX_EXECUTION_AMOUNT',
      'Max execution amount',
      candidate.amountUsdc <= safety.maxExecutionAmountUsdc ? 'pass' : 'block',
      `Per-job cap is ${formatUsdc(safety.maxExecutionAmountUsdc)} USDC.`,
    ),
    buildModeRiskCheck(mode, availability),
  ]

  if (
    candidate.type === 'payout-batch' ||
    candidate.type === 'treasury-sweep' ||
    candidate.type === 'rebalance' ||
    candidate.type === 'wallet-top-up'
  ) {
    const destination = candidate.destinationAddress
    checks.push(
      buildRiskCheck(
        'DESTINATION_ALLOWLIST',
        'Destination allowlist',
        safety.destinationAllowlist.length === 0 || isAllowlistedDestination(destination, safety.destinationAllowlist)
          ? 'pass'
          : 'block',
        safety.destinationAllowlist.length === 0
          ? 'Destination allowlist is not configured.'
          : destination
            ? 'Destination is allowlisted.'
            : 'No destination address was supplied.',
      ),
    )
  }

  if (candidate.type === 'bridge-top-up') {
    checks.push(
      buildRiskCheck(
        'BRIDGE_PROVIDER',
        'Bridge provider',
        availability.bridgeProviderAvailable ? 'pass' : 'block',
        availability.bridgeProviderAvailable
          ? 'Bridge provider credentials are present.'
          : 'Bridge execution is disabled until bridge credentials are configured.',
      ),
    )
  }

  return checks
}

export function formatRobotMode(mode: RobotExecutionMode): string {
  switch (mode) {
    case 'dry-run':
      return 'Dry run'
    case 'manual-approve':
      return 'Manual approve'
    case 'auto':
      return 'Auto'
  }
}

export function formatTreasuryJobType(type: TreasuryJobType): string {
  switch (type) {
    case 'rebalance':
      return 'Rebalance'
    case 'wallet-top-up':
      return 'Wallet top-up'
    case 'payout-batch':
      return 'Payout batch'
    case 'treasury-sweep':
      return 'Treasury sweep'
    case 'bridge-top-up':
      return 'Bridge top-up'
    case 'invoice-settlement':
      return 'Invoice settlement'
  }
}

export function formatTreasuryJobStatus(status: TreasuryJobStatus): string {
  switch (status) {
    case 'created':
      return 'Created'
    case 'planned':
      return 'Planned'
    case 'awaiting-approval':
      return 'Awaiting approval'
    case 'approved':
      return 'Approved'
    case 'rejected':
      return 'Rejected'
    case 'submitted':
      return 'Submitted'
    case 'confirmed':
      return 'Confirmed'
    case 'failed':
      return 'Failed'
    case 'cancelled':
      return 'Cancelled'
  }
}

export function formatRobotStatus(status: RobotStatus): string {
  switch (status) {
    case 'ready':
      return 'Ready'
    case 'working':
      return 'Working'
    case 'paused':
      return 'Paused'
    case 'blocked':
      return 'Blocked'
  }
}

export function isTreasuryJobTerminal(status: TreasuryJobStatus) {
  return status === 'confirmed' || status === 'failed' || status === 'rejected' || status === 'cancelled'
}

export function isTreasuryJobPending(status: TreasuryJobStatus) {
  return PENDING_JOB_STATUSES.has(status)
}

export function getRobotDayKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function sumRobotNotionalForDay(jobs: TreasuryJobRecord[], now: Date) {
  const dayKey = getRobotDayKey(now)

  return jobs.reduce((total, job) => {
    if (!COUNTED_JOB_STATUSES.has(job.status)) {
      return total
    }

    const jobTime = job.updatedAt ?? job.createdAt
    const jobDay = getRobotDayKey(new Date(jobTime))

    if (jobDay !== dayKey) {
      return total
    }

    return total + job.amountUsdc
  }, 0)
}

export function evaluateRobotSafety(
  jobs: TreasuryJobRecord[],
  safety: RobotSafetyConfig,
  now = new Date(),
): RobotSafetyEvaluation {
  const blockers: string[] = []

  if (safety.globalPaused) {
    blockers.push('GLOBAL_PAUSE')
  }

  if (safety.policyPaused) {
    blockers.push('POLICY_PAUSE')
  }

  if (safety.emergencyStop) {
    blockers.push('EMERGENCY_STOP')
  }

  const dailySpentUsdc = sumRobotNotionalForDay(jobs, now)
  const dailyRemainingUsdc = Math.max(0, safety.dailyNotionalCapUsdc - dailySpentUsdc)

  if (safety.dailyNotionalCapUsdc > 0 && dailyRemainingUsdc <= 0) {
    blockers.push('DAILY_NOTIONAL_CAP_REACHED')
  }

  const lastSubmitted = [...jobs]
    .filter((job) => COUNTED_JOB_STATUSES.has(job.status))
    .sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())[0]

  let cooldownRemainingMinutes = 0

  if (lastSubmitted) {
    const elapsedMs = now.getTime() - new Date(lastSubmitted.updatedAt).getTime()
    const cooldownMs = safety.cooldownMinutes * 60_000

    if (elapsedMs < cooldownMs) {
      cooldownRemainingMinutes = Math.max(0, Math.ceil((cooldownMs - elapsedMs) / 60_000))
      blockers.push('COOLDOWN_ACTIVE')
    }
  }

  return {
    allowed: blockers.length === 0,
    blockers,
    dailySpentUsdc,
    dailyRemainingUsdc,
    cooldownRemainingMinutes,
    destinationAllowlist: safety.destinationAllowlist,
  }
}

function buildPlanSummary(type: TreasuryJobType, amountUsdc: number, recipientCount = 0) {
  const amount = formatUsdc(amountUsdc)

  switch (type) {
    case 'wallet-top-up':
      return `Plan a wallet top-up of ${amount} USDC toward the treasury target.`
    case 'treasury-sweep':
      return `Plan a treasury sweep of ${amount} USDC back toward the treasury target.`
    case 'payout-batch':
      return `Plan a payout batch totaling ${amount} USDC across ${recipientCount} recipients.`
    case 'bridge-top-up':
      return `Plan a bridge top-up of ${amount} USDC into the treasury wallet.`
    case 'rebalance':
      return `Plan a rebalance of ${amount} USDC toward the configured destination.`
    case 'invoice-settlement':
      return `Plan an invoice settlement of ${amount} USDC.`
  }
}

export function buildRobotIdentity(params: {
  mode: RobotExecutionMode
  safety: RobotSafetyConfig
  availability: RobotAvailability
  jobs: TreasuryJobRecord[]
  name?: string
}): RobotIdentity {
  const name = params.name?.trim() || 'Arc Treasury Job Robot'

  let currentStatus: RobotStatus = 'ready'

  if (params.safety.globalPaused || params.safety.policyPaused || params.safety.emergencyStop) {
    currentStatus = 'paused'
  } else if (params.availability.missingEnvVars.length > 0 || (params.mode === 'auto' && !params.availability.autoEnabled)) {
    currentStatus = 'blocked'
  } else if (params.jobs.some((job) => isTreasuryJobPending(job.status))) {
    currentStatus = 'working'
  }

  return {
    name,
    supportedJobTypes: SUPPORTED_JOB_TYPES,
    currentMode: params.mode,
    currentStatus,
    onchainAgentIdentity: undefined,
  }
}

export function describeApprovalRequirement(mode: RobotExecutionMode) {
  switch (mode) {
    case 'dry-run':
      return 'Dry-run mode records the job without submission.'
    case 'manual-approve':
      return 'Manual approval is required before the job can be submitted.'
    case 'auto':
      return 'Auto mode can submit once the executor is available and safety checks pass.'
  }
}

export function selectTreasuryJobPlan(input: TreasuryJobPlanInput): TreasuryJobPlanResult {
  const safety = evaluateRobotSafety(input.jobs, input.safety, input.now)

  if (!safety.allowed) {
    return {
      candidate: null,
      safety,
      blockers: safety.blockers,
    }
  }

  const pendingJob = input.jobs.find((job) => isTreasuryJobPending(job.status))

  if (pendingJob) {
    return {
      candidate: null,
      safety,
      blockers: ['JOB_ALREADY_PENDING'],
    }
  }

  const snapshot = input.snapshot
  const maxUsdc = Math.max(0, input.safety.maxExecutionAmountUsdc)
  const dailyRemainingUsdc = safety.dailyRemainingUsdc > 0 ? safety.dailyRemainingUsdc : maxUsdc
  const policyCapUsdc = Math.max(0, snapshot.policy.maxRebalanceAmount)
  const executionCapUsdc = Math.min(maxUsdc, dailyRemainingUsdc, policyCapUsdc)

  if (snapshot.payoutRecipients.length > 0) {
    const amountUsdc = recipientSum(snapshot.payoutRecipients)

    if (amountUsdc > 0) {
      if (amountUsdc > snapshot.treasuryBalanceUsdc) {
        return {
          candidate: null,
          safety,
          blockers: ['INSUFFICIENT_BALANCE_FOR_PAYOUT'],
        }
      }

      if (amountUsdc > executionCapUsdc) {
        return {
          candidate: null,
          safety,
          blockers: ['MAX_EXECUTION_AMOUNT'],
        }
      }

      const invalidRecipient = snapshot.payoutRecipients.find(
        (recipient) =>
          safety.destinationAllowlist.length > 0 &&
          !isAllowlistedDestination(recipient.address, safety.destinationAllowlist),
      )

      if (invalidRecipient) {
        return {
          candidate: null,
          safety,
          blockers: ['DESTINATION_NOT_ALLOWLISTED'],
        }
      }

      const candidate: TreasuryJobCandidate = {
          type: 'payout-batch',
          amountUsdc,
          reason: 'Queued payout batch is ready to be processed.',
          reasonCodes: ['PAYOUT_BATCH_READY'],
          requestedAction: {
            summary: buildPlanSummary('payout-batch', amountUsdc, snapshot.payoutRecipients.length),
            triggerSource: input.triggerSource,
            rationale: 'Treasury recipients are queued and within the safety limits.',
          },
          parameters: {
            amountUsdc,
            recipients: snapshot.payoutRecipients,
          },
          riskChecks: [],
          destinationAddress: snapshot.payoutRecipients[0]?.address,
          destinationLabel: snapshot.payoutRecipients[0]?.label ?? 'Payout recipient',
          recipients: snapshot.payoutRecipients,
      }

      candidate.riskChecks = buildCommonRiskChecks(input.mode, input.safety, input.availability, candidate)

      return {
        candidate,
        safety,
        blockers: [],
      }
    }
  }

  if (snapshot.treasuryBalanceUsdc < snapshot.policy.minThreshold) {
    const amountUsdc = Math.max(
      0,
      Math.min(snapshot.policy.targetBalance - snapshot.treasuryBalanceUsdc, executionCapUsdc),
    )

    if (amountUsdc <= 0) {
      return {
        candidate: null,
        safety,
        blockers: ['MAX_EXECUTION_AMOUNT'],
      }
    }

    const destinationAddress = snapshot.treasuryAddress
    const bridgeCandidate = input.safety.bridgeTopUpEnabled && input.availability.bridgeProviderAvailable

    const candidate: TreasuryJobCandidate = {
      type: bridgeCandidate ? 'bridge-top-up' : 'wallet-top-up',
      amountUsdc,
      reason: 'Treasury balance is below the minimum threshold.',
      reasonCodes: ['BELOW_MIN_THRESHOLD', 'MOVE_TOWARD_TARGET'],
      requestedAction: {
        summary: bridgeCandidate
          ? buildPlanSummary('bridge-top-up', amountUsdc)
          : buildPlanSummary('wallet-top-up', amountUsdc),
        triggerSource: input.triggerSource,
        rationale: bridgeCandidate
          ? 'Bridge top-up is enabled and a bridge provider is configured.'
          : 'Top up the treasury wallet back toward the policy target.',
      },
      parameters: {
        amountUsdc,
        currentBalanceUsdc: snapshot.treasuryBalanceUsdc,
        minThresholdUsdc: snapshot.policy.minThreshold,
        targetBalanceUsdc: snapshot.policy.targetBalance,
        destinationAddress,
        destinationLabel: 'Treasury wallet',
        direction: 'top-up',
        bridgeEnabled: bridgeCandidate,
      },
      riskChecks: [],
      destinationAddress,
      destinationLabel: 'Treasury wallet',
    }

    candidate.riskChecks = buildCommonRiskChecks(input.mode, input.safety, input.availability, candidate)

    return {
      candidate,
      safety,
      blockers: [],
    }
  }

  if (snapshot.treasuryBalanceUsdc > snapshot.policy.targetBalance) {
    const destination = input.safety.rebalanceDestinationAddress ?? input.safety.destinationAllowlist[0]

    if (!destination) {
      return {
        candidate: null,
        safety,
        blockers: ['REBALANCE_DESTINATION_MISSING'],
      }
    }

    if (
      input.safety.destinationAllowlist.length > 0 &&
      !isAllowlistedDestination(destination, input.safety.destinationAllowlist)
    ) {
      return {
        candidate: null,
        safety,
        blockers: ['DESTINATION_NOT_ALLOWLISTED'],
      }
    }

    const amountUsdc = Math.max(
      0,
      Math.min(snapshot.treasuryBalanceUsdc - snapshot.policy.targetBalance, executionCapUsdc),
    )

    if (amountUsdc <= 0) {
      return {
        candidate: null,
        safety,
        blockers: ['MAX_EXECUTION_AMOUNT'],
      }
    }

    const candidate: TreasuryJobCandidate = {
      type: 'treasury-sweep',
      amountUsdc,
      reason: 'Treasury balance is above target and can be swept back into the policy band.',
      reasonCodes: ['ABOVE_TARGET_BALANCE', 'MOVE_TOWARD_TARGET'],
      requestedAction: {
        summary: buildPlanSummary('treasury-sweep', amountUsdc),
        triggerSource: input.triggerSource,
        rationale: 'Sweep excess USDC back toward the treasury target.',
      },
      parameters: {
        amountUsdc,
        currentBalanceUsdc: snapshot.treasuryBalanceUsdc,
        targetBalanceUsdc: snapshot.policy.targetBalance,
        destinationAddress: destination,
        destinationLabel: 'Rebalance destination',
        direction: 'sweep',
      },
      riskChecks: [],
      destinationAddress: destination,
      destinationLabel: 'Rebalance destination',
    }

    candidate.riskChecks = buildCommonRiskChecks(input.mode, input.safety, input.availability, candidate)

    return {
      candidate,
      safety,
      blockers: [],
    }
  }

  return {
    candidate: null,
    safety,
    blockers: ['WITHIN_POLICY_BAND'],
  }
}

export function summarizeTreasuryJobCandidate(candidate: TreasuryJobCandidate) {
  const destination = candidate.destinationLabel
    ? `${candidate.destinationLabel} (${candidate.destinationAddress ?? 'n/a'})`
    : candidate.destinationAddress
      ? `${candidate.destinationAddress}`
      : 'n/a'

  const amount = formatUsdc(candidate.amountUsdc)

  switch (candidate.type) {
    case 'wallet-top-up':
      return `Plan a wallet top-up of ${amount} USDC into the treasury wallet. Destination: ${destination}.`
    case 'bridge-top-up':
      return `Plan a bridge top-up of ${amount} USDC into the treasury wallet. Destination: ${destination}.`
    case 'payout-batch':
      return `Plan a payout batch totaling ${amount} USDC across ${candidate.recipients?.length ?? 0} recipients.`
    case 'treasury-sweep':
      return `Plan a treasury sweep of ${amount} USDC toward the configured destination.`
    case 'rebalance':
      return `Plan a rebalance of ${amount} USDC toward the configured destination.`
    case 'invoice-settlement':
      return `Plan an invoice settlement of ${amount} USDC.`
  }
}

export function makeJobTimelineEvent(
  status: TreasuryJobStatus,
  message: string,
  actor: TreasuryJobActor = 'robot',
): TreasuryJobTimelineEvent {
  return {
    status,
    at: new Date().toISOString(),
    actor,
    message,
  }
}

export function createInitialJobLogs(summary: string, status: TreasuryJobStatus) {
  return [summary, `Status: ${status}`]
}
