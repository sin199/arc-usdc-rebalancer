import { readFile, rename, writeFile } from 'node:fs/promises'
import {
  buildRobotIdentity,
  type RobotRuntimeState,
  type TreasuryJobRecord,
  type TreasuryJobRecipient,
  type TreasuryJobStatus,
  type TreasuryJobType,
  type TreasuryJobTimelineEvent,
} from '@arc-usdc-rebalancer/shared'
import { ensureStateDirectory } from './config'

export type RobotStore = {
  read(): Promise<RobotRuntimeState>
  write(state: RobotRuntimeState): Promise<void>
  update(
    mutator: (state: RobotRuntimeState) => RobotRuntimeState | Promise<RobotRuntimeState>,
  ): Promise<RobotRuntimeState>
  appendJob(job: TreasuryJobRecord): Promise<RobotRuntimeState>
}

function createDefaultIdentity(mode: RobotRuntimeState['mode'] = 'dry-run') {
  return buildRobotIdentity({
    mode,
    safety: {
      globalPaused: false,
      policyPaused: false,
      emergencyStop: false,
      maxExecutionAmountUsdc: 1_000,
      dailyNotionalCapUsdc: 5_000,
      cooldownMinutes: 30,
      destinationAllowlist: [],
      bridgeTopUpEnabled: false,
    },
    availability: {
      circleExecutorAvailable: false,
      bridgeProviderAvailable: false,
      autoEnabled: false,
      missingEnvVars: [],
    },
    jobs: [],
    name: 'Arc Treasury Job Robot',
  })
}

function createDefaultRobotState(): RobotRuntimeState {
  return {
    version: 2,
    robot: createDefaultIdentity(),
    mode: 'dry-run',
    safety: {
      globalPaused: false,
      policyPaused: false,
      emergencyStop: false,
      maxExecutionAmountUsdc: 1_000,
      dailyNotionalCapUsdc: 5_000,
      cooldownMinutes: 30,
      destinationAllowlist: [],
      bridgeTopUpEnabled: false,
    },
    availability: {
      circleExecutorAvailable: false,
      bridgeProviderAvailable: false,
      autoEnabled: false,
      missingEnvVars: [],
    },
    snapshot: null,
    jobs: [],
    lastTickAt: undefined,
    lastError: undefined,
  }
}

function legacyStatusToJobStatus(status: string | undefined): TreasuryJobStatus {
  switch (status) {
    case 'planned':
      return 'planned'
    case 'simulated':
      return 'planned'
    case 'awaiting-approval':
      return 'awaiting-approval'
    case 'approved':
      return 'approved'
    case 'rejected':
      return 'rejected'
    case 'submitted':
      return 'submitted'
    case 'confirmed':
      return 'confirmed'
    case 'failed':
      return 'failed'
    case 'cancelled':
      return 'cancelled'
    case 'created':
      return 'created'
    default:
      return 'planned'
  }
}

function legacyKindToJobType(kind: string | undefined): TreasuryJobType {
  switch (kind) {
    case 'rebalance':
      return 'rebalance'
    case 'payout_batch':
      return 'payout-batch'
    case 'bridge_top_up':
      return 'bridge-top-up'
    case 'threshold_top_up':
      return 'wallet-top-up'
    default:
      return 'rebalance'
  }
}

function timelineForLegacyJob(status: TreasuryJobStatus, createdAt: string, updatedAt: string): TreasuryJobTimelineEvent[] {
  const timeline: TreasuryJobTimelineEvent[] = [
    {
      status: 'created',
      at: createdAt,
      actor: 'system',
      message: 'Imported legacy execution record into the job robot store.',
    },
  ]

  if (status !== 'created') {
    timeline.push({
      status,
      at: updatedAt,
      actor: status === 'submitted' || status === 'confirmed' ? 'executor' : status === 'rejected' || status === 'cancelled' ? 'operator' : 'robot',
      message: `Legacy job status restored as ${status}.`,
    })
  }

  return timeline
}

function migrateLegacyState(raw: Record<string, unknown>): RobotRuntimeState {
  if (!Array.isArray(raw.latestRuns)) {
    return createDefaultRobotState()
  }

  const jobs = raw.latestRuns
    .map((run) => {
      if (typeof run !== 'object' || run === null) {
        return null
      }

      const record = run as Record<string, unknown>
      const createdAt = typeof record.createdAt === 'string' ? record.createdAt : new Date().toISOString()
      const updatedAt = typeof record.updatedAt === 'string' ? record.updatedAt : createdAt
      const status = legacyStatusToJobStatus(typeof record.status === 'string' ? record.status : undefined)
      const type = legacyKindToJobType(typeof record.kind === 'string' ? record.kind : undefined)
      const amountUsdc = typeof record.amountUsdc === 'number' ? record.amountUsdc : Number(record.amountUsdc ?? 0)
      const balanceUsdc = typeof record.balanceUsdc === 'number' ? record.balanceUsdc : Number(record.balanceUsdc ?? 0)
      const policyMinThresholdUsdc =
        typeof record.minThresholdUsdc === 'number' ? record.minThresholdUsdc : Number(record.minThresholdUsdc ?? 0)
      const policyTargetBalanceUsdc =
        typeof record.targetBalanceUsdc === 'number' ? record.targetBalanceUsdc : Number(record.targetBalanceUsdc ?? 0)
      const policyMaxRebalanceAmountUsdc =
        typeof record.policyMaxRebalanceAmountUsdc === 'number'
          ? record.policyMaxRebalanceAmountUsdc
          : Number(record.policyMaxRebalanceAmountUsdc ?? 0)

      return {
        id: typeof record.id === 'string' ? record.id : crypto.randomUUID(),
        type,
        amountUsdc: Number.isFinite(amountUsdc) ? amountUsdc : 0,
        requestedAction: {
          summary: typeof record.reason === 'string' ? record.reason : 'Legacy job imported from previous execution state.',
          triggerSource:
            record.triggerSource === 'manual' || record.triggerSource === 'approval' || record.triggerSource === 'startup'
              ? record.triggerSource
              : 'schedule',
          rationale: typeof record.reason === 'string' ? record.reason : 'Imported from legacy execution records.',
        },
        parameters: {
          amountUsdc: Number.isFinite(amountUsdc) ? amountUsdc : 0,
          currentBalanceUsdc: Number.isFinite(balanceUsdc) ? balanceUsdc : 0,
          minThresholdUsdc: Number.isFinite(policyMinThresholdUsdc) ? policyMinThresholdUsdc : 0,
          targetBalanceUsdc: Number.isFinite(policyTargetBalanceUsdc) ? policyTargetBalanceUsdc : 0,
          destinationAddress:
            typeof record.destinationAddress === 'string' && record.destinationAddress.startsWith('0x')
              ? (record.destinationAddress as `0x${string}`)
              : undefined,
          destinationLabel: typeof record.destinationLabel === 'string' ? record.destinationLabel : undefined,
          recipients: Array.isArray(record.recipients)
            ? (record.recipients as Array<Record<string, unknown>>)
                .map((recipient) => {
                  const address =
                    typeof recipient.address === 'string' && recipient.address.startsWith('0x')
                      ? (recipient.address as `0x${string}`)
                      : undefined

                  if (!address) {
                    return null
                  }

                  const recipientAmount =
                    typeof recipient.amountUsdc === 'number' ? recipient.amountUsdc : Number(recipient.amountUsdc ?? 0)

                  return {
                    address,
                    amountUsdc: Number.isFinite(recipientAmount) ? recipientAmount : 0,
                    ...(typeof recipient.label === 'string' ? { label: recipient.label } : {}),
                  } satisfies TreasuryJobRecipient
                })
                .filter((entry) => entry !== null) as TreasuryJobRecipient[]
            : undefined,
        },
        riskChecks: Array.isArray(record.reasonCodes)
          ? record.reasonCodes.map((code) => ({
              code: String(code),
              label: String(code),
              level: 'warn' as const,
              detail: 'Imported from legacy execution records.',
            }))
          : [],
        executionMode:
          record.mode === 'manual-approve' || record.mode === 'auto' ? record.mode : ('dry-run' as const),
        status,
        approvalRequired: status === 'awaiting-approval' || status === 'approved',
        approvalReason:
          status === 'awaiting-approval'
            ? 'Legacy run was waiting for approval.'
            : 'Imported from legacy execution records.',
        createdAt,
        updatedAt,
        policyAddress:
          typeof record.policyAddress === 'string' && record.policyAddress.startsWith('0x')
            ? (record.policyAddress as `0x${string}`)
            : ('0x0000000000000000000000000000000000000000' as `0x${string}`),
        treasuryAddress:
          typeof record.treasuryAddress === 'string' && record.treasuryAddress.startsWith('0x')
            ? (record.treasuryAddress as `0x${string}`)
            : ('0x0000000000000000000000000000000000000000' as `0x${string}`),
        balanceUsdc: Number.isFinite(balanceUsdc) ? balanceUsdc : 0,
        policyMinThresholdUsdc: Number.isFinite(policyMinThresholdUsdc) ? policyMinThresholdUsdc : 0,
        policyTargetBalanceUsdc: Number.isFinite(policyTargetBalanceUsdc) ? policyTargetBalanceUsdc : 0,
        policyMaxRebalanceAmountUsdc: Number.isFinite(policyMaxRebalanceAmountUsdc) ? policyMaxRebalanceAmountUsdc : 0,
        txHash: typeof record.txHash === 'string' ? record.txHash : undefined,
        txUrl: typeof record.txUrl === 'string' ? record.txUrl : undefined,
        result: typeof record.result === 'string' ? record.result : undefined,
        failureReason: typeof record.failureReason === 'string' ? record.failureReason : undefined,
        executor: {
          name:
            record.executor && typeof record.executor === 'object' && record.executor !== null
              ? ((record.executor as Record<string, unknown>).name as 'local' | 'circle' | 'bridge' | 'none') ?? 'none'
              : 'none',
          enabled:
            record.executor && typeof record.executor === 'object' && record.executor !== null
              ? Boolean((record.executor as Record<string, unknown>).enabled)
              : false,
          txHash:
            record.executor && typeof record.executor === 'object' && record.executor !== null
              ? typeof (record.executor as Record<string, unknown>).txHash === 'string'
                ? ((record.executor as Record<string, unknown>).txHash as string)
                : undefined
              : undefined,
          txUrl:
            record.executor && typeof record.executor === 'object' && record.executor !== null
              ? typeof (record.executor as Record<string, unknown>).txUrl === 'string'
                ? ((record.executor as Record<string, unknown>).txUrl as string)
                : undefined
              : undefined,
          error:
            record.executor && typeof record.executor === 'object' && record.executor !== null
              ? typeof (record.executor as Record<string, unknown>).error === 'string'
                ? ((record.executor as Record<string, unknown>).error as string)
                : undefined
              : undefined,
        },
        triggerSource:
          record.triggerSource === 'manual' || record.triggerSource === 'approval' || record.triggerSource === 'startup'
            ? record.triggerSource
            : 'schedule',
        logs: Array.isArray(record.logs) ? record.logs.map((line) => String(line)) : [],
        timeline: timelineForLegacyJob(status, createdAt, updatedAt),
      } satisfies TreasuryJobRecord
    })
    .filter((entry) => entry !== null) as TreasuryJobRecord[]

  const state: RobotRuntimeState = {
    version: 2,
    robot: buildRobotIdentity({
      mode:
        raw.mode === 'manual-approve' || raw.mode === 'auto' ? raw.mode : 'dry-run',
      safety: createDefaultRobotState().safety,
      availability: createDefaultRobotState().availability,
      jobs: sortJobsByNewest(jobs),
      name: 'Arc Treasury Job Robot',
    }),
    mode: raw.mode === 'manual-approve' || raw.mode === 'auto' ? raw.mode : 'dry-run',
    safety: createDefaultRobotState().safety,
    availability: createDefaultRobotState().availability,
    snapshot: null,
    jobs: sortJobsByNewest(jobs),
    lastTickAt: typeof raw.lastTickAt === 'string' ? raw.lastTickAt : undefined,
    lastError: typeof raw.lastError === 'string' ? raw.lastError : undefined,
  }

  return state
}

function normalizeState(raw: unknown): RobotRuntimeState {
  if (typeof raw !== 'object' || raw === null) {
    return createDefaultRobotState()
  }

  const record = raw as Record<string, unknown>

  if (record.version === 2 && Array.isArray(record.jobs)) {
    return {
      ...createDefaultRobotState(),
      ...(record as Partial<RobotRuntimeState>),
      robot: {
        ...createDefaultIdentity((record.mode as RobotRuntimeState['mode']) ?? 'dry-run'),
        ...(record.robot as Partial<RobotRuntimeState['robot']>),
      },
      jobs: sortJobsByNewest((record.jobs as TreasuryJobRecord[]) ?? []),
    }
  }

  if (Array.isArray(record.latestRuns)) {
    return migrateLegacyState(record)
  }

  return createDefaultRobotState()
}

export function createRobotStore(statePath: string): RobotStore {
  async function read(): Promise<RobotRuntimeState> {
    try {
      const raw = await readFile(statePath, 'utf8')
      return normalizeState(JSON.parse(raw))
    } catch {
      return createDefaultRobotState()
    }
  }

  async function write(state: RobotRuntimeState) {
    await ensureStateDirectory(statePath)
    const tempPath = `${statePath}.${process.pid}.tmp`
    await writeFile(tempPath, JSON.stringify(state, null, 2))
    await rename(tempPath, statePath)
  }

  async function update(
    mutator: (state: RobotRuntimeState) => RobotRuntimeState | Promise<RobotRuntimeState>,
  ) {
    const current = await read()
    const next = await mutator(current)
    await write(next)
    return next
  }

  async function appendJob(job: TreasuryJobRecord) {
    return update((state) => ({
      ...state,
      jobs: sortJobsByNewest([job, ...state.jobs]).slice(0, 50),
      lastTickAt: new Date().toISOString(),
    }))
  }

  return { read, write, update, appendJob }
}

export function createDefaultRobotStateSnapshot() {
  return createDefaultRobotState()
}

export function sortJobsByNewest(jobs: TreasuryJobRecord[]) {
  return [...jobs].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
}

export function jobById(jobs: TreasuryJobRecord[], jobId: string) {
  return jobs.find((job) => job.id === jobId)
}

export function replaceJob(jobs: TreasuryJobRecord[], updatedJob: TreasuryJobRecord) {
  return jobs.map((job) => (job.id === updatedJob.id ? updatedJob : job))
}

export function touchJob(job: TreasuryJobRecord, patch: Partial<TreasuryJobRecord>) {
  return {
    ...job,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
}
