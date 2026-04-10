import type { Address } from 'viem'
import { formatUsdc, type TreasuryPolicy } from './policy'

export type ExecutionMode = 'dry-run' | 'manual-approve' | 'auto'

export type ExecutionKind = 'rebalance' | 'threshold_top_up' | 'payout_batch' | 'bridge_top_up'

export type ExecutionStatus =
  | 'planned'
  | 'simulated'
  | 'awaiting-approval'
  | 'submitted'
  | 'confirmed'
  | 'failed'
  | 'rejected'

export type ExecutionRecipient = {
  address: Address
  amountUsdc: number
  label?: string
}

export type ExecutionSafetyConfig = {
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

export type ExecutionSnapshot = {
  policyAddress: Address
  treasuryAddress: Address
  policy: TreasuryPolicy
  treasuryBalanceUsdc: number
  balanceSource: 'chain' | 'override'
  balanceUpdatedAt: string
  payoutRecipients: ExecutionRecipient[]
  lastRunAt?: string
}

export type ExecutionSafetyEvaluation = {
  allowed: boolean
  blockers: string[]
  dailySpentUsdc: number
  dailyRemainingUsdc: number
  cooldownRemainingMinutes: number
}

export type ExecutionCandidate = {
  kind: ExecutionKind
  amountUsdc: number
  reason: string
  reasonCodes: string[]
  destinationAddress?: Address
  destinationLabel?: string
  recipients?: ExecutionRecipient[]
  requiresBridge: boolean
}

export type ExecutionAvailability = {
  circleExecutorAvailable: boolean
  bridgeProviderAvailable: boolean
  autoEnabled: boolean
  missingEnvVars: string[]
}

export type ExecutionRunRecord = {
  id: string
  mode: ExecutionMode
  kind: ExecutionKind
  status: ExecutionStatus
  policyAddress: Address
  treasuryAddress: Address
  amountUsdc: number
  balanceUsdc: number
  minThresholdUsdc: number
  targetBalanceUsdc: number
  destinationAddress?: Address
  destinationLabel?: string
  recipients: ExecutionRecipient[]
  reason: string
  reasonCodes: string[]
  triggerSource: 'schedule' | 'manual' | 'approval' | 'startup'
  createdAt: string
  lastTriggerTime: string
  updatedAt: string
  approvedAt?: string
  rejectedAt?: string
  submittedAt?: string
  confirmedAt?: string
  simulatedAt?: string
  failedAt?: string
  executor: {
    name: 'local' | 'circle' | 'bridge' | 'none'
    enabled: boolean
    txHash?: string
    txUrl?: string
    error?: string
  }
  safety: {
    blocked: boolean
    blockers: string[]
    dailyRemainingUsdc: number
    cooldownRemainingMinutes: number
  }
  logs: string[]
}

export type ExecutionRuntimeState = {
  version: 1
  mode: ExecutionMode
  safety: ExecutionSafetyConfig
  availability: ExecutionAvailability
  snapshot: ExecutionSnapshot | null
  latestRuns: ExecutionRunRecord[]
  lastTickAt?: string
  lastError?: string
}

export type ExecutionPlanInput = {
  now: Date
  snapshot: ExecutionSnapshot
  safety: ExecutionSafetyConfig
  availability: ExecutionAvailability
  latestRuns: ExecutionRunRecord[]
}

export type ExecutionPlanResult = {
  candidate: ExecutionCandidate | null
  safety: ExecutionSafetyEvaluation
  blockers: string[]
}

const COUNTED_STATUSES = new Set<ExecutionStatus>(['submitted', 'confirmed'])
const PENDING_STATUSES = new Set<ExecutionStatus>(['planned', 'awaiting-approval', 'submitted'])

export function formatExecutionMode(mode: ExecutionMode): string {
  switch (mode) {
    case 'dry-run':
      return 'Dry run'
    case 'manual-approve':
      return 'Manual approve'
    case 'auto':
      return 'Auto'
  }
}

export function formatExecutionKind(kind: ExecutionKind): string {
  switch (kind) {
    case 'rebalance':
      return 'Rebalance'
    case 'threshold_top_up':
      return 'Threshold top-up'
    case 'payout_batch':
      return 'Payout batch'
    case 'bridge_top_up':
      return 'Bridge top-up'
  }
}

export function formatExecutionStatus(status: ExecutionStatus): string {
  switch (status) {
    case 'planned':
      return 'Planned'
    case 'simulated':
      return 'Simulated'
    case 'awaiting-approval':
      return 'Awaiting approval'
    case 'submitted':
      return 'Submitted'
    case 'confirmed':
      return 'Confirmed'
    case 'failed':
      return 'Failed'
    case 'rejected':
      return 'Rejected'
  }
}

export function getExecutionDayKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

export function sumExecutionNotionalForDay(runs: ExecutionRunRecord[], now: Date) {
  const dayKey = getExecutionDayKey(now)

  return runs.reduce((total, run) => {
    if (!COUNTED_STATUSES.has(run.status)) {
      return total
    }

    const runTime = run.submittedAt ?? run.confirmedAt ?? run.createdAt
    const runDay = getExecutionDayKey(new Date(runTime))

    if (runDay !== dayKey) {
      return total
    }

    return total + run.amountUsdc
  }, 0)
}

export function evaluateExecutionSafety(
  runs: ExecutionRunRecord[],
  safety: ExecutionSafetyConfig,
  now = new Date(),
): ExecutionSafetyEvaluation {
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

  const dailySpentUsdc = sumExecutionNotionalForDay(runs, now)
  const dailyRemainingUsdc = Math.max(0, safety.dailyNotionalCapUsdc - dailySpentUsdc)

  if (safety.dailyNotionalCapUsdc > 0 && dailyRemainingUsdc <= 0) {
    blockers.push('DAILY_NOTIONAL_CAP_REACHED')
  }

  const lastSubmitted = [...runs]
    .filter((run) => COUNTED_STATUSES.has(run.status))
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
  }
}

function recipientSum(recipients: ExecutionRecipient[]) {
  return recipients.reduce((total, recipient) => total + recipient.amountUsdc, 0)
}

function isAllowlistedDestination(destination: Address | undefined, allowlist: Address[]) {
  if (!destination) {
    return false
  }

  return allowlist.some((allowed) => allowed.toLowerCase() === destination.toLowerCase())
}

export function selectExecutionPlan(input: ExecutionPlanInput): ExecutionPlanResult {
  const safety = evaluateExecutionSafety(input.latestRuns, input.safety, input.now)

  if (!safety.allowed) {
    return {
      candidate: null,
      safety,
      blockers: safety.blockers,
    }
  }

  const pendingRun = input.latestRuns.find((run) => PENDING_STATUSES.has(run.status))

  if (pendingRun) {
    return {
      candidate: null,
      safety,
      blockers: ['RUN_ALREADY_PENDING'],
    }
  }

  const { snapshot } = input
  const maxUsdc = Math.max(0, input.safety.maxExecutionAmountUsdc)
  const dailyRemainingUsdc = safety.dailyRemainingUsdc > 0 ? safety.dailyRemainingUsdc : maxUsdc
  const policyCapUsdc = Math.max(0, snapshot.policy.maxRebalanceAmount)
  const executionCapUsdc = Math.min(maxUsdc, dailyRemainingUsdc, policyCapUsdc)

  if (snapshot.treasuryBalanceUsdc < snapshot.policy.minThreshold) {
    const amountUsdc = Math.max(
      0,
      Math.min(snapshot.policy.targetBalance - snapshot.treasuryBalanceUsdc, executionCapUsdc),
    )

    if (amountUsdc <= 0) {
      return {
        candidate: null,
        safety,
        blockers: ['MAX_REBALANCE_AMOUNT'],
      }
    }

    return {
      candidate: {
        kind: input.safety.bridgeTopUpEnabled && input.availability.bridgeProviderAvailable
          ? 'bridge_top_up'
          : 'threshold_top_up',
        amountUsdc,
        reason: amountUsdc > 0 ? 'Treasury balance is below the minimum threshold.' : 'Threshold already satisfied.',
        reasonCodes: ['BELOW_MIN_THRESHOLD', 'MOVE_TOWARD_TARGET'],
        destinationAddress: snapshot.treasuryAddress,
        destinationLabel: 'Treasury wallet',
        requiresBridge: input.safety.bridgeTopUpEnabled && input.availability.bridgeProviderAvailable,
      },
      safety,
      blockers: [],
    }
  }

  if (snapshot.payoutRecipients.length > 0) {
    const amountUsdc = recipientSum(snapshot.payoutRecipients)

    if (amountUsdc > 0 && amountUsdc <= snapshot.treasuryBalanceUsdc && amountUsdc <= maxUsdc && amountUsdc <= dailyRemainingUsdc) {
      const invalidRecipient = snapshot.payoutRecipients.find(
        (recipient) => !isAllowlistedDestination(recipient.address, input.safety.destinationAllowlist),
      )

      if (invalidRecipient) {
        return {
          candidate: null,
          safety,
          blockers: ['DESTINATION_NOT_ALLOWLISTED'],
        }
      }

      return {
        candidate: {
          kind: 'payout_batch',
          amountUsdc,
          reason: 'Queued payout batch is ready to be processed.',
          reasonCodes: ['PAYOUT_BATCH_READY'],
          recipients: snapshot.payoutRecipients,
          destinationAddress: snapshot.payoutRecipients[0]?.address,
          destinationLabel: snapshot.payoutRecipients[0]?.label ?? 'Payout recipient',
          requiresBridge: false,
        },
        safety,
        blockers: [],
      }
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

    if (!isAllowlistedDestination(destination, input.safety.destinationAllowlist)) {
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
        blockers: ['MAX_REBALANCE_AMOUNT'],
      }
    }

    return {
      candidate: {
        kind: 'rebalance',
        amountUsdc,
        reason: 'Treasury balance is above target and can be reduced toward the policy band.',
        reasonCodes: ['ABOVE_TARGET_BALANCE', 'MOVE_TOWARD_TARGET'],
        destinationAddress: destination,
        destinationLabel: 'Rebalance destination',
        requiresBridge: false,
      },
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

export function summarizeExecutionCandidate(candidate: ExecutionCandidate) {
  const destination = candidate.destinationLabel
    ? `${candidate.destinationLabel} (${candidate.destinationAddress ?? 'n/a'})`
    : candidate.destinationAddress
      ? `${candidate.destinationAddress}`
      : 'n/a'

  const amount = formatUsdc(candidate.amountUsdc)

  switch (candidate.kind) {
    case 'threshold_top_up':
      return `Plan a threshold top-up of ${amount} USDC into the treasury wallet. Destination: ${destination}.`
    case 'bridge_top_up':
      return `Plan a bridge top-up of ${amount} USDC into the treasury wallet. Destination: ${destination}.`
    case 'payout_batch':
      return `Plan a payout batch totaling ${amount} USDC across ${candidate.recipients?.length ?? 0} recipients.`
    case 'rebalance':
      return `Plan a rebalance of ${amount} USDC toward the configured destination.`
  }
}

export function isExecutionRunTerminal(status: ExecutionStatus) {
  return status === 'simulated' || status === 'confirmed' || status === 'failed' || status === 'rejected'
}
