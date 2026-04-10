import { createPublicClient, defineChain, formatUnits, http } from 'viem'
import {
  arcTestnetChainId,
  arcTestnetExplorerUrl,
  arcUsdcAddress,
  arcUsdcDecimals,
  buildRobotIdentity,
  createInitialJobLogs,
  describeApprovalRequirement,
  erc20Abi,
  formatTreasuryJobType,
  makeJobTimelineEvent,
  selectTreasuryJobPlan,
  summarizeTreasuryJobCandidate,
  treasuryPolicyContractAbi,
  type RobotAvailability,
  type RobotExecutionMode,
  type RobotRuntimeState,
  type TreasuryJobCandidate,
  type TreasuryJobRecord,
  type TreasuryJobStatus,
  type TreasuryJobTimelineEvent,
  type TreasuryJobTrigger,
  type TreasurySnapshot,
} from '@arc-usdc-rebalancer/shared'
import {
  createDefaultRobotStateSnapshot,
  createRobotStore,
  jobById,
  replaceJob,
  sortJobsByNewest,
  touchJob,
  type RobotStore,
} from './store'
import { resolveWorkerConfig, type WorkerConfig } from './config'

const arcTestnet = defineChain({
  id: arcTestnetChainId,
  name: 'Arc Testnet',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: arcUsdcDecimals,
  },
  rpcUrls: {
    default: {
      http: ['https://rpc.testnet.arc.network'],
    },
  },
  blockExplorers: {
    default: {
      name: 'Arc Scan',
      url: arcTestnetExplorerUrl,
    },
  },
})

type LocalExecutionResult = {
  txHash: string
  txUrl?: string
  logs: string[]
}

function formatNumber(value: bigint) {
  return Number(formatUnits(value, arcUsdcDecimals))
}

function buildAvailability(config: WorkerConfig): RobotAvailability {
  return config.availability
}

function createLocalTxHash(jobId: string) {
  return `0x${jobId.replace(/[^a-fA-F0-9]/g, '').padEnd(64, '0').slice(0, 64)}`
}

async function submitLocalExecution(job: TreasuryJobRecord): Promise<LocalExecutionResult> {
  const txHash = createLocalTxHash(job.id)

  return {
    txHash,
    txUrl: `${arcTestnetExplorerUrl}/tx/${txHash}`,
    logs: [
      'Local test executor accepted the approved job.',
      `Prepared local transaction hash ${txHash}.`,
    ],
  }
}

function appendJobEvent(
  job: TreasuryJobRecord,
  status: TreasuryJobStatus,
  message: string,
  actor: TreasuryJobTimelineEvent['actor'] = 'robot',
  patch: Partial<TreasuryJobRecord> = {},
) {
  return touchJob(job, {
    ...patch,
    status,
    logs: [...job.logs, message],
    timeline: [...job.timeline, makeJobTimelineEvent(status, message, actor)],
  })
}

function buildJobRecord(params: {
  id: string
  config: WorkerConfig
  snapshot: TreasurySnapshot
  candidate: TreasuryJobCandidate
  triggerSource: TreasuryJobTrigger
  status: TreasuryJobStatus
  executorName: TreasuryJobRecord['executor']['name']
  executorEnabled: boolean
  result?: string
  failureReason?: string
  txHash?: string
  txUrl?: string
  note?: string
}): TreasuryJobRecord {
  const now = new Date().toISOString()
  const summary = summarizeTreasuryJobCandidate(params.candidate)
  const createdMessage = `Robot created a ${formatTreasuryJobType(params.candidate.type).toLowerCase()} job from the live Arc Testnet snapshot.`
  const logs = createInitialJobLogs(summary, 'created')
  if (params.note) {
    logs.push(params.note)
  }

  return {
    id: params.id,
    type: params.candidate.type,
    amountUsdc: params.candidate.amountUsdc,
    requestedAction: params.candidate.requestedAction,
    parameters: params.candidate.parameters,
    riskChecks: params.candidate.riskChecks,
    executionMode: params.config.mode,
    status: params.status,
    approvalRequired: params.config.mode === 'manual-approve',
    approvalReason: describeApprovalRequirement(params.config.mode),
    createdAt: now,
    updatedAt: now,
    policyAddress: params.snapshot.policyAddress,
    treasuryAddress: params.snapshot.treasuryAddress,
    balanceUsdc: params.snapshot.treasuryBalanceUsdc,
    policyMinThresholdUsdc: params.snapshot.policy.minThreshold,
    policyTargetBalanceUsdc: params.snapshot.policy.targetBalance,
    policyMaxRebalanceAmountUsdc: params.snapshot.policy.maxRebalanceAmount,
    txHash: params.txHash,
    txUrl: params.txUrl,
    result: params.result,
    failureReason: params.failureReason,
    executor: {
      name: params.executorName,
      enabled: params.executorEnabled,
      txHash: params.txHash,
      txUrl: params.txUrl,
      error: params.failureReason,
    },
    triggerSource: params.triggerSource,
    logs,
    timeline: [
      {
        status: 'created',
        at: now,
        actor: 'robot',
        message: createdMessage,
      },
    ],
  }
}

function buildDryRunJob(
  config: WorkerConfig,
  snapshot: TreasurySnapshot,
  candidate: TreasuryJobCandidate,
  triggerSource: TreasuryJobTrigger,
) {
  const created = buildJobRecord({
    id: crypto.randomUUID(),
    config,
    snapshot,
    candidate,
    triggerSource,
    status: 'created',
    executorName: 'none',
    executorEnabled: false,
  })

  return appendJobEvent(created, 'planned', 'Dry-run mode recorded the job without submission.', 'robot', {
    result: 'Dry-run plan recorded. No transaction was submitted.',
    executor: {
      ...created.executor,
      name: 'none',
      enabled: false,
    },
  })
}

function buildManualApprovalJob(
  config: WorkerConfig,
  snapshot: TreasurySnapshot,
  candidate: TreasuryJobCandidate,
  triggerSource: TreasuryJobTrigger,
) {
  const created = buildJobRecord({
    id: crypto.randomUUID(),
    config,
    snapshot,
    candidate,
    triggerSource,
    status: 'created',
    executorName: 'local',
    executorEnabled: true,
  })

  const planned = appendJobEvent(created, 'planned', 'Job plan recorded and queued for approval.', 'robot', {
    result: 'Job plan recorded. Awaiting operator approval.',
    executor: {
      ...created.executor,
      name: 'local',
      enabled: true,
    },
  })

  return appendJobEvent(planned, 'awaiting-approval', 'Manual approval is required before submission.', 'operator', {
    result: 'The job is waiting for operator approval.',
    executor: {
      ...planned.executor,
      name: 'local',
      enabled: true,
    },
  })
}

function buildAutoFailureJob(
  config: WorkerConfig,
  snapshot: TreasurySnapshot,
  candidate: TreasuryJobCandidate,
  triggerSource: TreasuryJobTrigger,
) {
  const created = buildJobRecord({
    id: crypto.randomUUID(),
    config,
    snapshot,
    candidate,
    triggerSource,
    status: 'created',
    executorName: 'none',
    executorEnabled: false,
  })

  const planned = appendJobEvent(created, 'planned', 'Job plan recorded for auto execution.', 'robot', {
    result: 'Job plan recorded. Auto execution was evaluated.',
    executor: {
      ...created.executor,
      name: 'none',
      enabled: false,
    },
  })

  const failureReason = config.availability.missingEnvVars.length > 0
    ? `Auto execution blocked. Missing credentials: ${config.availability.missingEnvVars.join(', ')}`
    : 'Auto execution is intentionally disabled in this build.'

  return appendJobEvent(planned, 'failed', failureReason, 'system', {
    failureReason,
    result: 'Auto execution is disabled in the safe demo build.',
    executor: {
      ...planned.executor,
      name: 'none',
      enabled: false,
      error: failureReason,
    },
  })
}

function buildStateWithFreshRobot(state: RobotRuntimeState, config: WorkerConfig): RobotRuntimeState {
  return {
    ...state,
    mode: config.mode,
    safety: config.safety,
    availability: buildAvailability(config),
    robot: buildRobotIdentity({
      mode: config.mode,
      safety: config.safety,
      availability: buildAvailability(config),
      jobs: state.jobs,
      name: state.robot.name,
    }),
    jobs: sortJobsByNewest(state.jobs),
  }
}

export async function readRuntimeSnapshot(config: WorkerConfig): Promise<TreasurySnapshot> {
  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(config.rpcUrl, {
      retryCount: 3,
    }),
  })

  const policyTuple = await publicClient.readContract({
    abi: treasuryPolicyContractAbi,
    address: config.policyAddress,
    functionName: 'getPolicy',
  })

  const policy = {
    minThreshold: formatNumber(policyTuple[0]),
    targetBalance: formatNumber(policyTuple[1]),
    maxRebalanceAmount: formatNumber(policyTuple[2]),
  }

  const treasuryBalanceUsdc =
    config.balanceOverrideUsdc !== undefined
      ? config.balanceOverrideUsdc
      : Number(
          formatUnits(
            await publicClient.readContract({
              abi: erc20Abi,
              address: arcUsdcAddress,
              functionName: 'balanceOf',
              args: [config.treasuryAddress],
            }),
            arcUsdcDecimals,
          ),
        )

  return {
    policyAddress: config.policyAddress,
    treasuryAddress: config.treasuryAddress,
    policy,
    treasuryBalanceUsdc,
    balanceSource: config.balanceOverrideUsdc !== undefined ? 'override' : 'chain',
    balanceUpdatedAt: new Date().toISOString(),
    payoutRecipients: config.payoutRecipients,
  }
}

export class RobotEngine {
  constructor(
    private readonly config: WorkerConfig,
    private readonly store: RobotStore,
  ) {}

  static async create(config: WorkerConfig) {
    const store = await createRuntimeStore(config.statePath)
    return new RobotEngine(config, store)
  }

  private decorateState(state: RobotRuntimeState): RobotRuntimeState {
    return buildStateWithFreshRobot(state, this.config)
  }

  async getState(): Promise<RobotRuntimeState> {
    const state = await this.store.read()
    return this.decorateState(state)
  }

  async getJob(jobId: string) {
    const state = await this.getState()
    return jobById(state.jobs, jobId) ?? null
  }

  async refreshSnapshot(triggerSource: TreasuryJobTrigger = 'schedule') {
    const currentState = await this.getState()
    const snapshot = await readRuntimeSnapshot(this.config)
    const now = new Date()
    const availability = buildAvailability(this.config)

    const plan = selectTreasuryJobPlan({
      now,
      snapshot,
      safety: this.config.safety,
      availability,
      jobs: currentState.jobs,
      triggerSource,
      mode: this.config.mode,
    })

    const nextState: RobotRuntimeState = {
      ...currentState,
      snapshot,
      mode: this.config.mode,
      safety: this.config.safety,
      availability,
      lastTickAt: now.toISOString(),
      lastError: undefined,
    }

    if (!plan.candidate) {
      const persisted = this.decorateState(nextState)
      await this.store.write(persisted)
      return persisted
    }

    const candidate = plan.candidate
    const nextJob =
      this.config.mode === 'dry-run'
        ? buildDryRunJob(this.config, snapshot, candidate, triggerSource)
        : this.config.mode === 'manual-approve'
          ? buildManualApprovalJob(this.config, snapshot, candidate, triggerSource)
          : buildAutoFailureJob(this.config, snapshot, candidate, triggerSource)

    const updatedState: RobotRuntimeState = {
      ...nextState,
      jobs: sortJobsByNewest([nextJob, ...currentState.jobs]),
      lastError: nextJob.failureReason,
      robot: buildRobotIdentity({
        mode: this.config.mode,
        safety: this.config.safety,
        availability,
        jobs: [nextJob, ...currentState.jobs],
        name: currentState.robot.name,
      }),
    }

    const persisted = this.decorateState(updatedState)
    await this.store.write(persisted)
    return persisted
  }

  async approveJob(jobId: string) {
    return this.store.update(async (state) => {
      const existing = jobById(state.jobs, jobId)

      if (!existing) {
        throw new Error(`Job not found: ${jobId}`)
      }

      if (existing.status !== 'awaiting-approval') {
        throw new Error(`Job ${jobId} is not awaiting approval`)
      }

      const approved = appendJobEvent(existing, 'approved', 'Operator approved the treasury job.', 'operator', {
        approvalRequired: false,
        approvalReason: 'Approved by operator.',
      })

      const localResult = await submitLocalExecution(approved)
      const submitted = appendJobEvent(
        approved,
        'submitted',
        'Local test executor submitted the approved job.',
        'executor',
        {
          txHash: localResult.txHash,
          txUrl: localResult.txUrl,
          executor: {
            ...approved.executor,
            name: 'local',
            enabled: true,
            txHash: localResult.txHash,
            txUrl: localResult.txUrl,
          },
          result: 'Submitted to the local test executor.',
          approvalRequired: false,
        },
      )

      const confirmed = appendJobEvent(
        submitted,
        'confirmed',
        'Local test executor confirmed the job.',
        'executor',
        {
          result: 'Confirmed by the local test executor.',
        },
      )

      const jobs = sortJobsByNewest(replaceJob(state.jobs, confirmed))

      return {
        ...state,
        jobs,
        lastTickAt: confirmed.updatedAt,
        lastError: undefined,
        robot: buildRobotIdentity({
          mode: state.mode,
          safety: state.safety,
          availability: state.availability,
          jobs,
          name: state.robot.name,
        }),
      }
    })
  }

  async rejectJob(jobId: string) {
    return this.store.update(async (state) => {
      const existing = jobById(state.jobs, jobId)

      if (!existing) {
        throw new Error(`Job not found: ${jobId}`)
      }

      if (existing.status !== 'awaiting-approval') {
        throw new Error(`Job ${jobId} is not awaiting approval`)
      }

      const rejected = appendJobEvent(existing, 'rejected', 'Manual rejection received. The job will not be submitted.', 'operator', {
        failureReason: 'Rejected by operator.',
        approvalRequired: false,
      })

      const jobs = sortJobsByNewest(replaceJob(state.jobs, rejected))

      return {
        ...state,
        jobs,
        lastTickAt: rejected.updatedAt,
        lastError: undefined,
        robot: buildRobotIdentity({
          mode: state.mode,
          safety: state.safety,
          availability: state.availability,
          jobs,
          name: state.robot.name,
        }),
      }
    })
  }

  async cancelJob(jobId: string) {
    return this.store.update(async (state) => {
      const existing = jobById(state.jobs, jobId)

      if (!existing) {
        throw new Error(`Job not found: ${jobId}`)
      }

      if (existing.status === 'submitted' || existing.status === 'confirmed' || existing.status === 'failed') {
        throw new Error(`Job ${jobId} can no longer be cancelled`)
      }

      const cancelled = appendJobEvent(existing, 'cancelled', 'Manual cancellation received. The job will not continue.', 'operator', {
        result: 'Cancelled by operator.',
        approvalRequired: false,
      })

      const jobs = sortJobsByNewest(replaceJob(state.jobs, cancelled))

      return {
        ...state,
        jobs,
        lastTickAt: cancelled.updatedAt,
        lastError: undefined,
        robot: buildRobotIdentity({
          mode: state.mode,
          safety: state.safety,
          availability: state.availability,
          jobs,
          name: state.robot.name,
        }),
      }
    })
  }
}

async function createRuntimeStore(statePath: string) {
  const store = createRobotStore(statePath)
  const current = await store.read()

  if (current.version !== 2) {
    await store.write(createDefaultRobotStateSnapshot())
  }

  return store
}

export async function createRobotEngineFromEnv(env = process.env) {
  const config = resolveWorkerConfig(env)
  const engine = await RobotEngine.create(config)

  return { engine, config }
}

export { RobotEngine as ExecutionEngine, createRobotEngineFromEnv as createExecutionEngineFromEnv }
