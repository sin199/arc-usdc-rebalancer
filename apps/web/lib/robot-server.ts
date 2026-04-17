import { createRobotEngineFromEnv } from '@arc-usdc-rebalancer/worker/src/engine'

const defaultStatePath = '/tmp/arc-treasury-job-robot-state.json'

declare global {
  // eslint-disable-next-line no-var
  var __arcRobotEnginePromise: Promise<Awaited<ReturnType<typeof createRobotEngineFromEnv>>> | undefined
}

function buildRobotEnv() {
  return {
    ...process.env,
    EXECUTION_STATE_PATH: process.env.EXECUTION_STATE_PATH?.trim() || defaultStatePath,
  }
}

async function createEngine() {
  const runtime = await createRobotEngineFromEnv(buildRobotEnv())

  try {
    const state = await runtime.engine.getState()
    if (!state.snapshot) {
      await runtime.engine.refreshSnapshot('startup')
    }
  } catch {
    // The dashboard handles unavailable runtime state explicitly.
  }

  return runtime
}

export async function getRobotRuntime() {
  globalThis.__arcRobotEnginePromise ??= createEngine()
  return globalThis.__arcRobotEnginePromise
}
