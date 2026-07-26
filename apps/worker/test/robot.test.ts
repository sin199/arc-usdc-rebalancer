import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import test, { after } from 'node:test'
import { type TreasuryJobRecord } from '@arc-usdc-rebalancer/shared'
import { createRobotServer } from '../src/server'
import { RobotEngine } from '../src/engine'
import { createDefaultRobotStateSnapshot, createRobotStore } from '../src/store'
import { resolveWorkerConfig } from '../src/config'

const testStateDirectory = mkdtempSync(path.join(tmpdir(), 'arc-worker-tests-'))

after(() => {
  rmSync(testStateDirectory, { force: true, recursive: true })
})

function makeConfig(overrides: Record<string, string | undefined>) {
  return resolveWorkerConfig({
    ARC_TESTNET_RPC_URL: 'https://rpc.testnet.arc.network',
    TREASURY_POLICY_ADDRESS: '0x4bFa1e67B1163B452d39f27F799B0A7D28F545f6',
    TREASURY_EXECUTION_ADDRESS: '0x0000000000000000000000000000000000000004',
    EXECUTION_DESTINATION_ALLOWLIST:
      '0x0000000000000000000000000000000000000005',
    EXECUTION_POLICY_MIN_THRESHOLD_USDC: '100',
    EXECUTION_POLICY_TARGET_BALANCE_USDC: '500',
    EXECUTION_POLICY_MAX_REBALANCE_AMOUNT_USDC: '200',
    WORKER_API_TOKEN: 'test-worker-token',
    ...overrides,
  })
}

async function createEngine(overrides: Record<string, string | undefined>) {
  const config = makeConfig(overrides)
  const store = createRobotStore(
    path.join(testStateDirectory, `${crypto.randomUUID()}.json`),
  )
  const engine = new RobotEngine(config, store)
  return { engine, config }
}

async function startRobotApi(overrides: Record<string, string | undefined>) {
  const { engine, config } = await createEngine(overrides)
  const server = createRobotServer(engine, config)

  await new Promise<void>((resolve) => {
    server.listen(0, resolve)
  })

  const address = server.address()
  if (!address || typeof address === 'string') {
    await new Promise<void>((resolve) => server.close(() => resolve()))
    throw new Error('Server did not bind to a TCP port')
  }

  const baseUrl = `http://127.0.0.1:${address.port}`

  return {
    baseUrl,
    engine,
    config,
    server,
    close: async () => {
      await new Promise<void>((resolve) => server.close(() => resolve()))
    },
  }
}

test('dry-run job plans without submission', async () => {
  const { engine } = await createEngine({
    EXECUTION_MODE: 'dry-run',
    EXECUTION_BALANCE_OVERRIDE_USDC: '50',
  })

  const state = await engine.refreshSnapshot('manual')
  const job = state.jobs[0]

  assert.ok(job)
  assert.equal(job.status, 'planned')
  assert.equal(job.executionMode, 'dry-run')
  assert.equal(job.txHash, undefined)
  assert.ok(job.type)
  assert.ok(job.timeline.some((entry) => entry.status === 'created'))
  assert.ok(job.timeline.some((entry) => entry.status === 'planned'))
})

test('manual approval flow records a simulation without a transaction', async () => {
  const { engine } = await createEngine({
    EXECUTION_MODE: 'manual-approve',
    EXECUTION_BALANCE_OVERRIDE_USDC: '50',
  })

  const plannedState = await engine.refreshSnapshot('manual')
  const awaitingJob = plannedState.jobs[0]

  assert.ok(awaitingJob)
  assert.equal(awaitingJob.status, 'awaiting-approval')

  const simulatedState = await engine.approveJob(awaitingJob.id)
  const simulatedJob = simulatedState.jobs[0]

  assert.ok(simulatedJob)
  assert.equal(simulatedJob.status, 'simulated')
  assert.equal(simulatedJob.txHash, undefined)
  assert.equal(simulatedJob.txUrl, undefined)
  assert.ok(simulatedJob.timeline.some((entry) => entry.status === 'approved'))
  assert.ok(
    simulatedJob.timeline.some((entry) => entry.status === 'submitting'),
  )
  assert.ok(simulatedJob.timeline.some((entry) => entry.status === 'simulated'))
})

test('auto mode stays blocked without Circle credentials', async () => {
  const { engine, config } = await createEngine({
    EXECUTION_MODE: 'auto',
    EXECUTION_BALANCE_OVERRIDE_USDC: '50',
  })

  const state = await engine.refreshSnapshot('manual')

  assert.equal(config.availability.autoEnabled, false)
  assert.equal(state.jobs[0]?.status, 'failed')
  assert.match(state.jobs[0]?.failureReason ?? '', /Missing credentials/i)
})

test('robot API exposes jobs and lifecycle routes', async () => {
  const api = await startRobotApi({
    EXECUTION_MODE: 'manual-approve',
    EXECUTION_BALANCE_OVERRIDE_USDC: '50',
  })

  try {
    const createdResponse = await fetch(`${api.baseUrl}/api/jobs`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-worker-token',
      },
      body: JSON.stringify({ triggerSource: 'manual' }),
    })

    assert.equal(createdResponse.ok, true)
    const createdState = (await createdResponse.json()) as {
      jobs: TreasuryJobRecord[]
    }
    assert.equal(createdState.jobs.length, 1)

    const jobId = createdState.jobs[0]?.id
    assert.ok(jobId)

    const jobsResponse = await fetch(`${api.baseUrl}/api/jobs`)
    assert.equal(jobsResponse.ok, true)
    const jobs = (await jobsResponse.json()) as TreasuryJobRecord[]
    assert.equal(jobs.length, 1)

    const detailResponse = await fetch(
      `${api.baseUrl}/api/jobs/${encodeURIComponent(jobId)}`,
    )
    assert.equal(detailResponse.ok, true)
    const job = (await detailResponse.json()) as TreasuryJobRecord
    assert.equal(job.id, jobId)
    assert.equal(job.status, 'awaiting-approval')

    const cancelResponse = await fetch(
      `${api.baseUrl}/api/jobs/${encodeURIComponent(jobId)}/cancel`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer test-worker-token' },
      },
    )
    assert.equal(cancelResponse.ok, true)
    const cancelledState = (await cancelResponse.json()) as {
      jobs: TreasuryJobRecord[]
    }
    assert.equal(cancelledState.jobs[0]?.status, 'cancelled')

    const statusResponse = await fetch(`${api.baseUrl}/api/robot/status`)
    assert.equal(statusResponse.ok, true)
    const status = (await statusResponse.json()) as {
      robot: { currentMode: string; currentStatus: string }
    }
    assert.equal(status.robot.currentMode, 'manual-approve')
    assert.equal(status.robot.currentStatus, 'ready')
  } finally {
    await api.close()
  }
})

test('worker rejects unauthenticated and oversized mutation requests', async () => {
  const api = await startRobotApi({
    EXECUTION_MODE: 'manual-approve',
    EXECUTION_BALANCE_OVERRIDE_USDC: '50',
    WORKER_MAX_BODY_BYTES: '1024',
  })

  try {
    const unauthenticated = await fetch(`${api.baseUrl}/api/jobs`, {
      method: 'POST',
      body: JSON.stringify({ triggerSource: 'manual' }),
    })
    assert.equal(unauthenticated.status, 401)

    const oversized = await fetch(`${api.baseUrl}/api/jobs`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer test-worker-token',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        triggerSource: 'manual',
        padding: 'x'.repeat(2_000),
      }),
    })
    assert.equal(oversized.status, 413)
  } finally {
    await api.close()
  }
})

test('job creation route persists dashboard jobs and approval flow still works', async () => {
  const api = await startRobotApi({
    EXECUTION_MODE: 'manual-approve',
    EXECUTION_BALANCE_OVERRIDE_USDC: '50',
  })

  try {
    const createResponse = await fetch(`${api.baseUrl}/api/jobs/create`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer test-worker-token',
      },
      body: JSON.stringify({
        jobType: 'rebalance',
        amountUsdc: 12.5,
        destinationAddress: '0x0000000000000000000000000000000000000005',
        executionMode: 'manual-approve',
        notes: 'Create job from the dashboard form.',
      }),
    })

    assert.equal(createResponse.status, 201)

    const createdState = (await createResponse.json()) as {
      jobs: TreasuryJobRecord[]
    }
    const createdJob = createdState.jobs[0]

    assert.ok(createdJob)
    assert.equal(createdJob.type, 'rebalance')
    assert.equal(createdJob.status, 'awaiting-approval')
    assert.equal(createdJob.executionMode, 'manual-approve')
    assert.equal(
      createdJob.parameters.destinationAddress,
      '0x0000000000000000000000000000000000000005',
    )
    assert.ok(createdJob.requestedAction.rationale.includes('dashboard form'))
    assert.ok(createdJob.timeline.some((entry) => entry.status === 'created'))
    assert.ok(
      createdJob.timeline.some((entry) => entry.status === 'awaiting-approval'),
    )

    const jobsResponse = await fetch(`${api.baseUrl}/api/jobs`)
    assert.equal(jobsResponse.ok, true)
    const jobs = (await jobsResponse.json()) as TreasuryJobRecord[]
    assert.equal(jobs[0]?.id, createdJob.id)

    const detailResponse = await fetch(
      `${api.baseUrl}/api/jobs/${encodeURIComponent(createdJob.id)}`,
    )
    assert.equal(detailResponse.ok, true)
    const detail = (await detailResponse.json()) as TreasuryJobRecord
    assert.equal(detail.id, createdJob.id)

    const approveResponse = await fetch(
      `${api.baseUrl}/api/jobs/${encodeURIComponent(createdJob.id)}/approve`,
      {
        method: 'POST',
        headers: { Authorization: 'Bearer test-worker-token' },
      },
    )
    assert.equal(approveResponse.ok, true)
    const approvedState = (await approveResponse.json()) as {
      jobs: TreasuryJobRecord[]
    }
    assert.equal(approvedState.jobs[0]?.status, 'simulated')
    assert.ok(
      approvedState.jobs[0]?.timeline.some(
        (entry) => entry.status === 'submitting',
      ),
    )
    assert.ok(
      approvedState.jobs[0]?.timeline.some(
        (entry) => entry.status === 'simulated',
      ),
    )

    const statusResponse = await fetch(`${api.baseUrl}/api/robot/status`)
    assert.equal(statusResponse.ok, true)
    const status = (await statusResponse.json()) as {
      robot: { currentMode: string; currentStatus: string }
    }
    assert.equal(status.robot.currentMode, 'manual-approve')
    assert.equal(status.robot.currentStatus, 'ready')
  } finally {
    await api.close()
  }
})

test('concurrent approval can only claim a job once', async () => {
  const { engine } = await createEngine({
    EXECUTION_MODE: 'manual-approve',
    EXECUTION_BALANCE_OVERRIDE_USDC: '50',
  })
  const planned = await engine.refreshSnapshot('manual')
  const job = planned.jobs[0]
  assert.ok(job)

  const results = await Promise.allSettled([
    engine.approveJob(job.id),
    engine.approveJob(job.id),
  ])

  assert.equal(
    results.filter((result) => result.status === 'fulfilled').length,
    1,
  )
  assert.equal(
    results.filter((result) => result.status === 'rejected').length,
    1,
  )
  const finalState = await engine.getState()
  assert.equal(finalState.jobs[0]?.status, 'simulated')
})

test('independent stores serialize updates to the same state file', async () => {
  const statePath = path.join(testStateDirectory, `${crypto.randomUUID()}.json`)
  const firstStore = createRobotStore(statePath)
  const secondStore = createRobotStore(statePath)
  await firstStore.write(createDefaultRobotStateSnapshot())

  await Promise.all(
    Array.from({ length: 4 }, (_, index) => {
      const store = index % 2 === 0 ? firstStore : secondStore
      return store.update(async (state) => {
        await new Promise((resolve) => setTimeout(resolve, 5))
        return {
          ...state,
          lastError: String(Number(state.lastError ?? '0') + 1),
        }
      })
    }),
  )

  const finalState = await firstStore.read()
  assert.equal(finalState.lastError, '4')
})
