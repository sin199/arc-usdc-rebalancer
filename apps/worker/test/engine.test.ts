import assert from 'node:assert/strict'
import test from 'node:test'
import type { ExecutionCandidate, ExecutionRunRecord, TreasuryPolicy } from '@arc-usdc-rebalancer/shared'
import { evaluateExecutionSafety, selectExecutionPlan } from '@arc-usdc-rebalancer/shared'
import { ExecutionEngine } from '../src/engine'
import { createDefaultExecutionState, createExecutionStore } from '../src/store'
import { resolveWorkerConfig } from '../src/config'

function makePolicy(overrides: Partial<TreasuryPolicy> = {}): TreasuryPolicy {
  return {
    minThreshold: 100,
    targetBalance: 500,
    maxRebalanceAmount: 200,
    ...overrides,
  }
}

function makeSnapshot(balanceUsdc: number, recipients: ExecutionCandidate['recipients'] = []) {
  return {
    policyAddress: '0x0000000000000000000000000000000000000001' as const,
    treasuryAddress: '0x0000000000000000000000000000000000000002' as const,
    policy: makePolicy(),
    treasuryBalanceUsdc: balanceUsdc,
    balanceSource: 'override' as const,
    balanceUpdatedAt: new Date().toISOString(),
    payoutRecipients: recipients ?? [],
  }
}

test('dry-run candidate becomes simulated', () => {
  const config = resolveWorkerConfig({
    ARC_TESTNET_RPC_URL: 'https://rpc.testnet.arc.network',
    TREASURY_POLICY_ADDRESS: '0x0000000000000000000000000000000000000003',
    TREASURY_EXECUTION_ADDRESS: '0x0000000000000000000000000000000000000004',
    EXECUTION_MODE: 'dry-run',
    EXECUTION_BALANCE_OVERRIDE_USDC: '50',
    EXECUTION_DESTINATION_ALLOWLIST: '0x0000000000000000000000000000000000000005',
  })

  const plan = selectExecutionPlan({
    now: new Date('2026-04-10T00:00:00Z'),
    snapshot: makeSnapshot(50),
    safety: config.safety,
    availability: config.circle,
    latestRuns: [],
  })

  assert.ok(plan.candidate)
  assert.equal(plan.candidate?.kind, 'threshold_top_up')
  assert.equal(plan.safety.allowed, true)
})

test('planner respects onchain max rebalance amount', () => {
  const config = resolveWorkerConfig({
    ARC_TESTNET_RPC_URL: 'https://rpc.testnet.arc.network',
    TREASURY_POLICY_ADDRESS: '0x0000000000000000000000000000000000000003',
    TREASURY_EXECUTION_ADDRESS: '0x0000000000000000000000000000000000000004',
    EXECUTION_MODE: 'dry-run',
    EXECUTION_BALANCE_OVERRIDE_USDC: '10',
    EXECUTION_MAX_EXECUTION_AMOUNT_USDC: '1000',
    EXECUTION_DESTINATION_ALLOWLIST: '0x0000000000000000000000000000000000000005',
  })

  const plan = selectExecutionPlan({
    now: new Date('2026-04-10T00:00:00Z'),
    snapshot: {
      ...makeSnapshot(10),
      policy: makePolicy({ maxRebalanceAmount: 40 }),
    },
    safety: config.safety,
    availability: config.circle,
    latestRuns: [],
  })

  assert.ok(plan.candidate)
  assert.equal(plan.candidate?.amountUsdc, 40)
  assert.ok(plan.candidate?.reasonCodes.includes('MOVE_TOWARD_TARGET'))
})

test('manual approval config is not auto enabled without Circle credentials', () => {
  const config = resolveWorkerConfig({
    ARC_TESTNET_RPC_URL: 'https://rpc.testnet.arc.network',
    TREASURY_POLICY_ADDRESS: '0x0000000000000000000000000000000000000003',
    TREASURY_EXECUTION_ADDRESS: '0x0000000000000000000000000000000000000004',
    EXECUTION_MODE: 'manual-approve',
    EXECUTION_BALANCE_OVERRIDE_USDC: '50',
    EXECUTION_DESTINATION_ALLOWLIST: '0x0000000000000000000000000000000000000005',
  })

  assert.equal(config.circle.autoEnabled, false)
  assert.equal(config.circle.missingEnvVars.length, 0)
})

test('safety evaluation blocks paused execution', () => {
  const evaluation = evaluateExecutionSafety(
    [],
    {
      globalPaused: true,
      policyPaused: false,
      emergencyStop: false,
      maxExecutionAmountUsdc: 1000,
      dailyNotionalCapUsdc: 5000,
      cooldownMinutes: 30,
      destinationAllowlist: [],
      bridgeTopUpEnabled: false,
    },
    new Date('2026-04-10T00:00:00Z'),
  )

  assert.equal(evaluation.allowed, false)
  assert.ok(evaluation.blockers.includes('GLOBAL_PAUSE'))
})

test('local store round trips execution state', async () => {
  const tempPath = `${process.cwd()}/.tmp-worker-state-${crypto.randomUUID()}.json`
  const store = createExecutionStore(tempPath)
  const state = createDefaultExecutionState()

  await store.write(state)
  const loaded = await store.read()

  assert.equal(loaded.version, 1)
  assert.equal(loaded.latestRuns.length, 0)
})

test('manual approval transitions to confirmed with local execution', async () => {
  const tempPath = `${process.cwd()}/.tmp-worker-approval-${crypto.randomUUID()}.json`
  const store = createExecutionStore(tempPath)
  const config = resolveWorkerConfig({
    ARC_TESTNET_RPC_URL: 'https://rpc.testnet.arc.network',
    TREASURY_POLICY_ADDRESS: '0x0000000000000000000000000000000000000003',
    TREASURY_EXECUTION_ADDRESS: '0x0000000000000000000000000000000000000004',
    EXECUTION_MODE: 'manual-approve',
    EXECUTION_BALANCE_OVERRIDE_USDC: '50',
    EXECUTION_DESTINATION_ALLOWLIST: '0x0000000000000000000000000000000000000005',
  })

  const now = new Date().toISOString()
  const awaitingRun: ExecutionRunRecord = {
    id: 'run-1',
    mode: 'manual-approve',
    kind: 'threshold_top_up',
    status: 'awaiting-approval',
    policyAddress: '0x0000000000000000000000000000000000000003',
    treasuryAddress: '0x0000000000000000000000000000000000000004',
    amountUsdc: 100,
    balanceUsdc: 50,
    minThresholdUsdc: 100,
    targetBalanceUsdc: 500,
    destinationAddress: '0x0000000000000000000000000000000000000004',
    destinationLabel: 'Treasury wallet',
    recipients: [],
    reason: 'Treasury balance is below the minimum threshold.',
    reasonCodes: ['BELOW_MIN_THRESHOLD', 'MOVE_TOWARD_TARGET'],
    triggerSource: 'schedule',
    createdAt: now,
    lastTriggerTime: now,
    updatedAt: now,
    executor: {
      name: 'local',
      enabled: true,
    },
    safety: {
      blocked: false,
      blockers: [],
      dailyRemainingUsdc: 5000,
      cooldownRemainingMinutes: 0,
    },
    logs: ['Queued for approval.'],
  }

  await store.write({
    ...createDefaultExecutionState(),
    mode: 'manual-approve',
    latestRuns: [awaitingRun],
  })

  const engine = new ExecutionEngine(config, store)
  const nextState = await engine.approveRun('run-1')
  const run = nextState.latestRuns[0]

  assert.equal(run.status, 'confirmed')
  assert.equal(run.executor.name, 'local')
  assert.ok(run.executor.txHash)
})
