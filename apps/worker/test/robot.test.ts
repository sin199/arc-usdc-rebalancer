import assert from 'node:assert/strict'
import test from 'node:test'
import { type TreasuryJobRecord } from '@arc-usdc-rebalancer/shared'
import { createRobotServer } from '../src/server'
import { RobotEngine } from '../src/engine'
import { createRobotStore } from '../src/store'
import { resolveWorkerConfig } from '../src/config'

function makeConfig(overrides: Record<string, string | undefined>) {
  return resolveWorkerConfig({
    ARC_TESTNET_RPC_URL: 'https://rpc.testnet.arc.network',
    TREASURY_POLICY_ADDRESS: '0x4bFa1e67B1163B452d39f27F799B0A7D28F545f6',
    TREASURY_EXECUTION_ADDRESS: '0x0000000000000000000000000000000000000004',
    EXECUTION_DESTINATION_ALLOWLIST: '0x0000000000000000000000000000000000000005',
    ...overrides,
  })
}

async function createEngine(overrides: Record<string, string | undefined>) {
  const config = makeConfig(overrides)
  const store = createRobotStore(`${process.cwd()}/.tmp-robot-${crypto.randomUUID()}.json`)
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

test('manual approval flow confirms after approval', async () => {
  const { engine } = await createEngine({
    EXECUTION_MODE: 'manual-approve',
    EXECUTION_BALANCE_OVERRIDE_USDC: '50',
  })

  const plannedState = await engine.refreshSnapshot('manual')
  const awaitingJob = plannedState.jobs[0]

  assert.ok(awaitingJob)
  assert.equal(awaitingJob.status, 'awaiting-approval')

  const confirmedState = await engine.approveJob(awaitingJob.id)
  const confirmedJob = confirmedState.jobs[0]

  assert.ok(confirmedJob)
  assert.equal(confirmedJob.status, 'confirmed')
  assert.ok(confirmedJob.txHash)
  assert.ok(confirmedJob.timeline.some((entry) => entry.status === 'approved'))
  assert.ok(confirmedJob.timeline.some((entry) => entry.status === 'submitted'))
  assert.ok(confirmedJob.timeline.some((entry) => entry.status === 'confirmed'))
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
      },
      body: JSON.stringify({ triggerSource: 'manual' }),
    })

    assert.equal(createdResponse.ok, true)
    const createdState = (await createdResponse.json()) as { jobs: TreasuryJobRecord[] }
    assert.equal(createdState.jobs.length, 1)

    const jobId = createdState.jobs[0]?.id
    assert.ok(jobId)

    const jobsResponse = await fetch(`${api.baseUrl}/api/jobs`)
    assert.equal(jobsResponse.ok, true)
    const jobs = (await jobsResponse.json()) as TreasuryJobRecord[]
    assert.equal(jobs.length, 1)

    const detailResponse = await fetch(`${api.baseUrl}/api/jobs/${encodeURIComponent(jobId)}`)
    assert.equal(detailResponse.ok, true)
    const job = (await detailResponse.json()) as TreasuryJobRecord
    assert.equal(job.id, jobId)
    assert.equal(job.status, 'awaiting-approval')

    const cancelResponse = await fetch(`${api.baseUrl}/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
      method: 'POST',
    })
    assert.equal(cancelResponse.ok, true)
    const cancelledState = (await cancelResponse.json()) as { jobs: TreasuryJobRecord[] }
    assert.equal(cancelledState.jobs[0]?.status, 'cancelled')

    const statusResponse = await fetch(`${api.baseUrl}/api/robot/status`)
    assert.equal(statusResponse.ok, true)
    const status = (await statusResponse.json()) as { robot: { currentMode: string; currentStatus: string } }
    assert.equal(status.robot.currentMode, 'manual-approve')
    assert.equal(status.robot.currentStatus, 'ready')
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

    const createdState = (await createResponse.json()) as { jobs: TreasuryJobRecord[] }
    const createdJob = createdState.jobs[0]

    assert.ok(createdJob)
    assert.equal(createdJob.type, 'rebalance')
    assert.equal(createdJob.status, 'awaiting-approval')
    assert.equal(createdJob.executionMode, 'manual-approve')
    assert.equal(createdJob.parameters.destinationAddress, '0x0000000000000000000000000000000000000005')
    assert.ok(createdJob.requestedAction.rationale.includes('dashboard form'))
    assert.ok(createdJob.timeline.some((entry) => entry.status === 'created'))
    assert.ok(createdJob.timeline.some((entry) => entry.status === 'awaiting-approval'))

    const jobsResponse = await fetch(`${api.baseUrl}/api/jobs`)
    assert.equal(jobsResponse.ok, true)
    const jobs = (await jobsResponse.json()) as TreasuryJobRecord[]
    assert.equal(jobs[0]?.id, createdJob.id)

    const detailResponse = await fetch(`${api.baseUrl}/api/jobs/${encodeURIComponent(createdJob.id)}`)
    assert.equal(detailResponse.ok, true)
    const detail = (await detailResponse.json()) as TreasuryJobRecord
    assert.equal(detail.id, createdJob.id)

    const approveResponse = await fetch(`${api.baseUrl}/api/jobs/${encodeURIComponent(createdJob.id)}/approve`, {
      method: 'POST',
    })
    assert.equal(approveResponse.ok, true)
    const approvedState = (await approveResponse.json()) as { jobs: TreasuryJobRecord[] }
    assert.equal(approvedState.jobs[0]?.status, 'confirmed')
    assert.ok(approvedState.jobs[0]?.timeline.some((entry) => entry.status === 'submitted'))
    assert.ok(approvedState.jobs[0]?.timeline.some((entry) => entry.status === 'confirmed'))

    const statusResponse = await fetch(`${api.baseUrl}/api/robot/status`)
    assert.equal(statusResponse.ok, true)
    const status = (await statusResponse.json()) as { robot: { currentMode: string; currentStatus: string } }
    assert.equal(status.robot.currentMode, 'manual-approve')
    assert.equal(status.robot.currentStatus, 'ready')
  } finally {
    await api.close()
  }
})
