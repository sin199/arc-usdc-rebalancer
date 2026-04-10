import { readFile, rename, writeFile } from 'node:fs/promises'
import type { ExecutionRuntimeState, ExecutionRunRecord } from '@arc-usdc-rebalancer/shared'
import { ensureStateDirectory } from './config'

export type ExecutionStore = {
  read(): Promise<ExecutionRuntimeState>
  write(state: ExecutionRuntimeState): Promise<void>
  update(mutator: (state: ExecutionRuntimeState) => ExecutionRuntimeState | Promise<ExecutionRuntimeState>): Promise<ExecutionRuntimeState>
  appendRun(run: ExecutionRunRecord): Promise<ExecutionRuntimeState>
}

export function createDefaultExecutionState(): ExecutionRuntimeState {
  return {
    version: 1,
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
    latestRuns: [],
    lastTickAt: undefined,
    lastError: undefined,
  }
}

export function createExecutionStore(statePath: string): ExecutionStore {
  async function read(): Promise<ExecutionRuntimeState> {
    try {
      const raw = await readFile(statePath, 'utf8')
      return JSON.parse(raw) as ExecutionRuntimeState
    } catch {
      return createDefaultExecutionState()
    }
  }

  async function write(state: ExecutionRuntimeState) {
    await ensureStateDirectory(statePath)
    const tempPath = `${statePath}.${process.pid}.tmp`
    await writeFile(tempPath, JSON.stringify(state, null, 2))
    await rename(tempPath, statePath)
  }

  async function update(mutator: (state: ExecutionRuntimeState) => ExecutionRuntimeState | Promise<ExecutionRuntimeState>) {
    const current = await read()
    const next = await mutator(current)
    await write(next)
    return next
  }

  async function appendRun(run: ExecutionRunRecord) {
    return update((state) => ({
      ...state,
      latestRuns: [run, ...state.latestRuns].slice(0, 25),
      lastTickAt: new Date().toISOString(),
    }))
  }

  return { read, write, update, appendRun }
}

export function sortRunsByNewest(runs: ExecutionRunRecord[]) {
  return [...runs].sort((left, right) => new Date(right.updatedAt).getTime() - new Date(left.updatedAt).getTime())
}

export function runById(runs: ExecutionRunRecord[], runId: string) {
  return runs.find((run) => run.id === runId)
}

export function replaceRun(runs: ExecutionRunRecord[], updatedRun: ExecutionRunRecord) {
  return runs.map((run) => (run.id === updatedRun.id ? updatedRun : run))
}

export function touchRun(run: ExecutionRunRecord, patch: Partial<ExecutionRunRecord>) {
  return {
    ...run,
    ...patch,
    updatedAt: new Date().toISOString(),
  }
}
