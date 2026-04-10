import { createPublicClient, defineChain, formatUnits, http } from 'viem'
import {
  arcTestnetChainId,
  arcTestnetExplorerUrl,
  arcUsdcAddress,
  arcUsdcDecimals,
  erc20Abi,
  selectExecutionPlan,
  summarizeExecutionCandidate,
  treasuryPolicyContractAbi,
  type ExecutionAvailability,
  type ExecutionCandidate,
  type ExecutionRunRecord,
  type ExecutionRuntimeState,
  type ExecutionSnapshot,
  type ExecutionStatus,
} from '@arc-usdc-rebalancer/shared'
import { createDefaultExecutionState, replaceRun, runById, sortRunsByNewest, touchRun, type ExecutionStore } from './store'
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

function buildAvailability(config: WorkerConfig): ExecutionAvailability {
  return {
    circleExecutorAvailable: config.circle.circleExecutorAvailable,
    bridgeProviderAvailable: config.circle.bridgeProviderAvailable,
    autoEnabled: config.circle.autoEnabled,
    missingEnvVars: config.circle.missingEnvVars,
  }
}

function buildRunLogs(candidate: ExecutionCandidate, status: ExecutionStatus, note?: string) {
  const logs = [summarizeExecutionCandidate(candidate), `Status: ${status}`]

  if (note) {
    logs.push(note)
  }

  return logs
}

function createLocalTxHash(runId: string) {
  return `0x${runId.replace(/[^a-fA-F0-9]/g, '').padEnd(64, '0').slice(0, 64)}`
}

async function submitLocalExecution(run: ExecutionRunRecord): Promise<LocalExecutionResult> {
  const txHash = createLocalTxHash(run.id)

  return {
    txHash,
    txUrl: `${arcTestnetExplorerUrl}/tx/${txHash}`,
    logs: ['Local test executor accepted the run.', `Prepared local transaction hash ${txHash}.`],
  }
}

export async function readRuntimeSnapshot(config: WorkerConfig): Promise<ExecutionSnapshot> {
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

function buildRunRecord(params: {
  id: string
  config: WorkerConfig
  snapshot: ExecutionSnapshot
  candidate: ExecutionCandidate
  status: ExecutionStatus
  triggerSource: ExecutionRunRecord['triggerSource']
  executorName: ExecutionRunRecord['executor']['name']
  executorEnabled: boolean
  note?: string
  txHash?: string
  txUrl?: string
  blockers?: string[]
  safety: ExecutionRunRecord['safety']
}): ExecutionRunRecord {
  const now = new Date().toISOString()

  return {
    id: params.id,
    mode: params.config.mode,
    kind: params.candidate.kind,
    status: params.status,
    policyAddress: params.snapshot.policyAddress,
    treasuryAddress: params.snapshot.treasuryAddress,
    amountUsdc: params.candidate.amountUsdc,
    balanceUsdc: params.snapshot.treasuryBalanceUsdc,
    minThresholdUsdc: params.snapshot.policy.minThreshold,
    targetBalanceUsdc: params.snapshot.policy.targetBalance,
    destinationAddress: params.candidate.destinationAddress,
    destinationLabel: params.candidate.destinationLabel,
    recipients: params.candidate.recipients ?? [],
    reason: params.candidate.reason,
    reasonCodes: params.candidate.reasonCodes,
    triggerSource: params.triggerSource,
    createdAt: now,
    lastTriggerTime: now,
    updatedAt: now,
    approvedAt: undefined,
    rejectedAt: undefined,
    submittedAt: params.status === 'submitted' ? now : undefined,
    confirmedAt: params.status === 'confirmed' ? now : undefined,
    simulatedAt: params.status === 'simulated' ? now : undefined,
    failedAt: params.status === 'failed' ? now : undefined,
    executor: {
      name: params.executorName,
      enabled: params.executorEnabled,
      txHash: params.txHash,
      txUrl: params.txUrl,
      error: params.status === 'failed' ? params.note : undefined,
    },
    safety: params.safety,
    logs: buildRunLogs(params.candidate, params.status, params.note),
  }
}

export class ExecutionEngine {
  constructor(
    private readonly config: WorkerConfig,
    private readonly store: ExecutionStore,
  ) {}

  static async create(config: WorkerConfig) {
    const store = await createRuntimeStore(config.statePath)
    return new ExecutionEngine(config, store)
  }

  async getState(): Promise<ExecutionRuntimeState> {
    const state = await this.store.read()
    return {
      ...state,
      mode: this.config.mode,
      safety: this.config.safety,
      availability: buildAvailability(this.config),
    }
  }

  async refreshSnapshot(triggerSource: ExecutionRunRecord['triggerSource'] = 'schedule') {
    const currentState = await this.getState()
    const snapshot = await readRuntimeSnapshot(this.config)
    const now = new Date()
    const availability = buildAvailability(this.config)

    const plan = selectExecutionPlan({
      now,
      snapshot,
      safety: this.config.safety,
      availability,
      latestRuns: currentState.latestRuns,
    })

    const nextState: ExecutionRuntimeState = {
      ...currentState,
      snapshot,
      mode: this.config.mode,
      safety: this.config.safety,
      availability,
      lastTickAt: now.toISOString(),
      lastError: undefined,
    }

    if (!plan.candidate) {
      await this.store.write({
        ...nextState,
        latestRuns: sortRunsByNewest(currentState.latestRuns),
      })

      return nextState
    }

    const candidate = plan.candidate
    const safety = {
      blocked: Boolean(plan.blockers.length > 0),
      blockers: plan.blockers,
      dailyRemainingUsdc: plan.safety.dailyRemainingUsdc,
      cooldownRemainingMinutes: plan.safety.cooldownRemainingMinutes,
    }

    if (this.config.mode === 'dry-run') {
      const run = buildRunRecord({
        id: crypto.randomUUID(),
        config: this.config,
        snapshot,
        candidate,
        status: 'simulated',
        triggerSource,
        executorName: 'local',
        executorEnabled: false,
        note: 'Dry run only. No transaction was submitted.',
        blockers: plan.blockers,
        safety,
      })

      const updatedState = {
        ...nextState,
        latestRuns: sortRunsByNewest([run, ...currentState.latestRuns]),
      }

      await this.store.write(updatedState)
      return updatedState
    }

    if (this.config.mode === 'manual-approve') {
      const run = buildRunRecord({
        id: crypto.randomUUID(),
        config: this.config,
        snapshot,
        candidate,
        status: 'awaiting-approval',
        triggerSource,
        executorName: 'local',
        executorEnabled: true,
        note: 'Run is awaiting manual approval.',
        blockers: plan.blockers,
        safety,
      })

      const updatedState = {
        ...nextState,
        latestRuns: sortRunsByNewest([run, ...currentState.latestRuns]),
      }

      await this.store.write(updatedState)
      return updatedState
    }

    const failedRun = buildRunRecord({
      id: crypto.randomUUID(),
      config: this.config,
      snapshot,
      candidate,
      status: 'failed',
      triggerSource,
      executorName: 'none',
      executorEnabled: false,
      note: this.config.circle.circleExecutorAvailable
        ? 'Auto execution is intentionally disabled in this build.'
        : `Auto execution blocked. Missing credentials: ${this.config.circle.missingEnvVars.join(', ')}`,
      blockers: this.config.circle.circleExecutorAvailable ? ['AUTO_EXECUTION_DISABLED'] : ['AUTO_CREDENTIALS_MISSING', ...this.config.circle.missingEnvVars],
      safety,
    })

    const updatedState = {
      ...nextState,
      lastError: failedRun.executor.error,
      latestRuns: sortRunsByNewest([failedRun, ...currentState.latestRuns]),
    }

    await this.store.write(updatedState)
    return updatedState
  }

  async approveRun(runId: string) {
    return this.store.update(async (state) => {
      const existing = runById(state.latestRuns, runId)

      if (!existing) {
        throw new Error(`Run not found: ${runId}`)
      }

      if (existing.status !== 'awaiting-approval') {
        throw new Error(`Run ${runId} is not awaiting approval`)
      }

      const localResult = await submitLocalExecution(existing)
      const submittedAt = new Date().toISOString()

      const submitted = touchRun(existing, {
        status: 'submitted',
        approvedAt: submittedAt,
        submittedAt,
        executor: {
          ...existing.executor,
          name: 'local',
          enabled: true,
          txHash: localResult.txHash,
          txUrl: localResult.txUrl,
        },
        logs: [...existing.logs, 'Manual approval received. Local test executor submitted the run.', ...localResult.logs],
      })

      const confirmedAt = new Date().toISOString()
      const confirmed = touchRun(submitted, {
        status: 'confirmed',
        confirmedAt,
        logs: [...submitted.logs, 'Local test executor confirmed the run.'],
      })

      return {
        ...state,
        latestRuns: sortRunsByNewest(replaceRun(state.latestRuns, confirmed)),
        lastTickAt: confirmedAt,
      }
    })
  }

  async rejectRun(runId: string) {
    return this.store.update(async (state) => {
      const existing = runById(state.latestRuns, runId)

      if (!existing) {
        throw new Error(`Run not found: ${runId}`)
      }

      if (existing.status !== 'awaiting-approval') {
        throw new Error(`Run ${runId} is not awaiting approval`)
      }

      const rejectedAt = new Date().toISOString()
      const rejected = touchRun(existing, {
        status: 'rejected',
        rejectedAt,
        logs: [...existing.logs, 'Manual rejection received. Run will not be submitted.'],
      })

      return {
        ...state,
        latestRuns: sortRunsByNewest(replaceRun(state.latestRuns, rejected)),
        lastTickAt: rejectedAt,
      }
    })
  }
}

async function createRuntimeStore(statePath: string) {
  const { createExecutionStore } = await import('./store')
  const store = createExecutionStore(statePath)
  const current = await store.read()

  if (!current.version) {
    await store.write(createDefaultExecutionState())
  }

  return store
}

export async function createExecutionEngineFromEnv(env = process.env) {
  const config = resolveWorkerConfig(env)
  const engine = await ExecutionEngine.create(config)

  return { engine, config }
}
