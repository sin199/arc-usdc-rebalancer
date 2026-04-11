import { createPublicClient, defineChain, formatUnits, http, isAddress, type Address } from 'viem'
import {
  arcTestnetChainId,
  arcTestnetExplorerUrl,
  arcUsdcAddress,
  arcUsdcDecimals,
  buildRobotIdentity,
  createInitialJobLogs,
  describeApprovalRequirement,
  erc20Abi,
  formatUsdc,
  formatTreasuryJobType,
  makeJobTimelineEvent,
  selectTreasuryJobPlan,
  sumRobotNotionalForDay,
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

type CreateJobRequest = {
  type: TreasuryJobCandidate['type']
  amountUsdc: number
  destinationAddress: Address
  executionMode: RobotExecutionMode
  notes?: string
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

function createFallbackSnapshot(config: WorkerConfig): TreasurySnapshot {
  return {
    policyAddress: config.policyAddress,
    treasuryAddress: config.treasuryAddress,
    policy: {
      minThreshold: config.balanceOverrideUsdc ?? 0,
      targetBalance: config.balanceOverrideUsdc ?? 0,
      maxRebalanceAmount: config.safety.maxExecutionAmountUsdc,
    },
    treasuryBalanceUsdc: config.balanceOverrideUsdc ?? 0,
    balanceSource: config.balanceOverrideUsdc !== undefined ? 'override' : 'chain',
    balanceUpdatedAt: new Date().toISOString(),
    payoutRecipients: [],
  }
}

function jobDestinationLabel(type: TreasuryJobCandidate['type']) {
  switch (type) {
    case 'wallet-top-up':
      return 'Treasury wallet'
    case 'payout-batch':
      return 'Payout recipient'
    case 'treasury-sweep':
      return 'Sweep destination'
    case 'rebalance':
      return 'Rebalance destination'
    case 'bridge-top-up':
      return 'Bridge destination'
    case 'invoice-settlement':
      return 'Invoice destination'
  }
}

function createJobSummary(request: CreateJobRequest) {
  const amount = formatUsdc(request.amountUsdc)
  const destination = request.destinationAddress

  switch (request.type) {
    case 'rebalance':
      return `Plan a rebalance of ${amount} USDC toward ${destination}.`
    case 'wallet-top-up':
      return `Plan a wallet top-up of ${amount} USDC into ${destination}.`
    case 'payout-batch':
      return `Plan a payout batch totaling ${amount} USDC for ${destination}.`
    case 'treasury-sweep':
      return `Plan a treasury sweep of ${amount} USDC toward ${destination}.`
    case 'bridge-top-up':
      return `Plan a bridge top-up of ${amount} USDC toward ${destination}.`
    case 'invoice-settlement':
      return `Plan an invoice settlement of ${amount} USDC for ${destination}.`
  }
}

function createJobRiskChecks(
  state: RobotRuntimeState,
  request: CreateJobRequest,
  config: WorkerConfig,
  snapshot: TreasurySnapshot,
): TreasuryJobCandidate['riskChecks'] {
  const dailySpent = sumRobotNotionalForDay(state.jobs, new Date())
  const dailyRemaining = Math.max(0, state.safety.dailyNotionalCapUsdc - dailySpent)
  const amountWithinMax = request.amountUsdc <= state.safety.maxExecutionAmountUsdc
  const amountWithinDaily = request.amountUsdc <= dailyRemaining
  const allowlist = state.safety.destinationAllowlist
  const destinationAllowed =
    allowlist.length === 0 || allowlist.some((allowed) => allowed.toLowerCase() === request.destinationAddress.toLowerCase())
  const autoEnabled = config.availability.autoEnabled

  return [
    {
      code: 'JOB_TYPE',
      label: 'Job type',
      level: 'pass',
      detail: `Creating a ${formatTreasuryJobType(request.type).toLowerCase()} job from the dashboard.`,
    },
    {
      code: 'AMOUNT_LIMIT',
      label: 'Amount limit',
      level: amountWithinMax ? 'pass' : 'block',
      detail: amountWithinMax
        ? `Amount is within the per-job cap of ${formatUsdc(state.safety.maxExecutionAmountUsdc)} USDC.`
        : `Amount exceeds the per-job cap of ${formatUsdc(state.safety.maxExecutionAmountUsdc)} USDC.`,
    },
    {
      code: 'DAILY_CAP',
      label: 'Daily cap',
      level: amountWithinDaily ? 'pass' : 'block',
      detail: amountWithinDaily
        ? `Remaining daily capacity is ${formatUsdc(dailyRemaining)} USDC.`
        : `Daily capacity is exhausted for the current day.`,
    },
    {
      code: 'DESTINATION_ALLOWLIST',
      label: 'Destination allowlist',
      level: destinationAllowed ? 'pass' : 'block',
      detail: destinationAllowed
        ? allowlist.length === 0
          ? 'No destination allowlist is configured.'
          : 'Destination is on the allowlist.'
        : `Destination ${request.destinationAddress} is not on the allowlist.`,
    },
    {
      code: 'EXECUTION_MODE',
      label: 'Execution mode',
      level:
        request.executionMode === 'auto'
          ? autoEnabled
            ? 'pass'
            : 'block'
          : request.executionMode === 'manual-approve'
            ? 'warn'
            : 'warn',
      detail:
        request.executionMode === 'auto'
          ? autoEnabled
            ? 'Auto execution is enabled for this robot.'
            : 'Auto execution is not available in this environment.'
          : request.executionMode === 'manual-approve'
            ? 'Manual approval is required before the job can be submitted.'
            : 'Dry-run mode records the job without submitting a transaction.',
    },
    {
      code: 'SNAPSHOT_SOURCE',
      label: 'Snapshot source',
      level: snapshot.balanceSource === 'chain' || snapshot.balanceSource === 'override' ? 'pass' : 'warn',
      detail:
        snapshot.balanceSource === 'override'
          ? 'Current policy snapshot uses an override balance.'
          : 'Current policy snapshot was read from chain state.',
    },
  ]
}

function buildCreateJobCandidate(request: CreateJobRequest, snapshot: TreasurySnapshot): TreasuryJobCandidate {
  const destinationLabel = jobDestinationLabel(request.type)
  const rationale = request.notes?.trim() || 'Created manually from the dashboard.'
  const recipients =
    request.type === 'payout-batch'
      ? [
          {
            address: request.destinationAddress,
            amountUsdc: request.amountUsdc,
            label: destinationLabel,
          },
        ]
      : undefined

  const candidate: TreasuryJobCandidate = {
    type: request.type,
    amountUsdc: request.amountUsdc,
    requestedAction: {
      summary: createJobSummary(request),
      triggerSource: 'manual',
      rationale,
    },
    parameters: {
      amountUsdc: request.amountUsdc,
      currentBalanceUsdc: snapshot.treasuryBalanceUsdc,
      minThresholdUsdc: snapshot.policy.minThreshold,
      targetBalanceUsdc: snapshot.policy.targetBalance,
      destinationAddress: request.destinationAddress,
      destinationLabel,
      direction:
        request.type === 'wallet-top-up'
          ? 'top-up'
          : request.type === 'treasury-sweep'
            ? 'sweep'
            : undefined,
      recipients,
      memo: request.notes?.trim() || undefined,
    },
    riskChecks: [],
    reason: rationale,
    reasonCodes: ['MANUAL_ENTRY'],
    destinationAddress: request.destinationAddress,
    destinationLabel,
    recipients,
  }

  return candidate
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
  executionMode?: RobotExecutionMode
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
  const logs = createInitialJobLogs(summary, 'created')
  if (params.note) {
    logs.push(params.note)
  }
  const executionMode = params.executionMode ?? params.config.mode

  return {
    id: params.id,
    type: params.candidate.type,
    amountUsdc: params.candidate.amountUsdc,
    requestedAction: params.candidate.requestedAction,
    parameters: params.candidate.parameters,
    riskChecks: params.candidate.riskChecks,
    executionMode,
    status: params.status,
    approvalRequired: executionMode === 'manual-approve',
    approvalReason: describeApprovalRequirement(executionMode),
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
        message: `Created ${summary}`,
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

  async createJob(request: CreateJobRequest) {
    return this.store.update(async (state) => {
      const freshState = buildStateWithFreshRobot(state, this.config)
      const snapshot = freshState.snapshot ?? createFallbackSnapshot(this.config)
      const candidate = buildCreateJobCandidate(request, snapshot)
      candidate.riskChecks = createJobRiskChecks(freshState, request, this.config, snapshot)

      const baseJob = buildJobRecord({
        id: crypto.randomUUID(),
        config: this.config,
        snapshot,
        candidate,
        triggerSource: 'manual',
        executionMode: request.executionMode,
        status: 'created',
        executorName: request.executionMode === 'dry-run' ? 'none' : 'local',
        executorEnabled: request.executionMode !== 'dry-run',
        note: request.notes?.trim() ? `Operator note: ${request.notes.trim()}` : undefined,
      })

      let finalJob = appendJobEvent(baseJob, 'planned', 'Operator created the job from the dashboard.', 'operator', {
        result:
          request.executionMode === 'dry-run'
            ? 'Dry-run plan recorded. No transaction was submitted.'
            : request.executionMode === 'manual-approve'
              ? 'Job plan recorded. Awaiting operator approval.'
              : 'Auto execution was evaluated.',
      })

      if (request.executionMode === 'manual-approve') {
        finalJob = appendJobEvent(finalJob, 'awaiting-approval', 'Manual approval is required before submission.', 'operator', {
          approvalRequired: true,
          approvalReason: 'Manual approval is required before the job can be submitted.',
        })
      } else if (request.executionMode === 'auto') {
        if (this.config.availability.autoEnabled) {
          const localResult = await submitLocalExecution(finalJob)

          finalJob = appendJobEvent(
            finalJob,
            'submitted',
            'Local test executor submitted the created job.',
            'executor',
            {
              txHash: localResult.txHash,
              txUrl: localResult.txUrl,
              executor: {
                ...finalJob.executor,
                name: 'local',
                enabled: true,
                txHash: localResult.txHash,
                txUrl: localResult.txUrl,
              },
              result: 'Submitted to the local test executor.',
              approvalRequired: false,
            },
          )

          finalJob = appendJobEvent(finalJob, 'confirmed', 'Local test executor confirmed the job.', 'executor', {
            result: 'Confirmed by the local test executor.',
          })
        } else {
          finalJob = appendJobEvent(finalJob, 'failed', 'Auto execution is unavailable in this environment.', 'system', {
            failureReason: 'Auto execution is unavailable in this environment.',
            result: 'Auto execution was not performed.',
            executor: {
              ...finalJob.executor,
              name: 'none',
              enabled: false,
              error: 'Auto execution is unavailable in this environment.',
            },
          })
        }
      }

      const jobs = sortJobsByNewest([finalJob, ...freshState.jobs]).slice(0, 50)

      return {
        ...freshState,
        snapshot,
        lastTickAt: finalJob.updatedAt,
        lastError: finalJob.failureReason,
        jobs,
        robot: buildRobotIdentity({
          mode: this.config.mode,
          safety: this.config.safety,
          availability: buildAvailability(this.config),
          jobs,
          name: freshState.robot.name,
        }),
      }
    })
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
