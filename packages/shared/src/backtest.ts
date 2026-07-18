import {
  DEFAULT_TREASURY_POLICY,
  evaluatePolicy,
  type TreasuryPolicy,
} from './policy'
import {
  selectTreasuryJobPlan,
  type RobotAvailability,
  type RobotSafetyConfig,
  type TreasuryJobRecord,
  type TreasurySnapshot,
} from './robot'

const policyAddress = '0x0000000000000000000000000000000000000001'
const treasuryAddress = '0x0000000000000000000000000000000000000002'
const destinationAddress = '0x0000000000000000000000000000000000000003'
const alternateDestinationAddress = '0x0000000000000000000000000000000000000004'

const availability: RobotAvailability = {
  autoEnabled: false,
  bridgeProviderAvailable: false,
  circleExecutorAvailable: false,
  missingEnvVars: [],
}

function makeSafety(
  policy: TreasuryPolicy,
  overrides: Partial<RobotSafetyConfig> = {},
): RobotSafetyConfig {
  return {
    bridgeTopUpEnabled: false,
    cooldownMinutes: 0,
    dailyNotionalCapUsdc: 100_000,
    destinationAllowlist: [destinationAddress],
    emergencyStop: false,
    globalPaused: false,
    maxExecutionAmountUsdc: policy.maxRebalanceAmount,
    policyPaused: false,
    rebalanceDestinationAddress: destinationAddress,
    ...overrides,
  }
}

function makeSnapshot(
  balance: number,
  policy: TreasuryPolicy,
): TreasurySnapshot {
  return {
    balanceSource: 'override',
    balanceUpdatedAt: '2026-07-18T00:00:00.000Z',
    payoutRecipients: [],
    policy,
    policyAddress,
    treasuryAddress,
    treasuryBalanceUsdc: balance,
  }
}

function workerDecision(params: {
  balance: number
  jobs?: TreasuryJobRecord[]
  now?: Date
  policy: TreasuryPolicy
  safety?: RobotSafetyConfig
}) {
  const plan = selectTreasuryJobPlan({
    availability,
    jobs: params.jobs ?? [],
    mode: 'dry-run',
    now: params.now ?? new Date('2026-07-18T12:00:00.000Z'),
    safety: params.safety ?? makeSafety(params.policy),
    snapshot: makeSnapshot(params.balance, params.policy),
    triggerSource: 'schedule',
  })
  const action =
    plan.candidate?.type === 'wallet-top-up' ||
    plan.candidate?.type === 'bridge-top-up'
      ? 'top_up'
      : plan.candidate?.type === 'treasury-sweep'
        ? 'trim'
        : plan.blockers.includes('WITHIN_POLICY_BAND')
          ? 'hold'
          : 'blocked'

  return {
    action,
    amount: plan.candidate?.amountUsdc ?? 0,
    blockers: plan.blockers,
  }
}

function makeJob(
  status: TreasuryJobRecord['status'],
  updatedAt: string,
  amountUsdc = 100,
) {
  return {
    amountUsdc,
    createdAt: updatedAt,
    id: `${status}-${updatedAt}`,
    status,
    updatedAt,
  } as TreasuryJobRecord
}

export type BacktestReport = ReturnType<typeof runTreasuryRobotBacktest>

export function runTreasuryRobotBacktest(
  policy: TreasuryPolicy = DEFAULT_TREASURY_POLICY,
) {
  const balances = [
    ...Array.from({ length: 1001 }, (_, index) => index),
    policy.minThreshold - 0.01,
    policy.targetBalance + 0.01,
  ]
  const sweepRows = balances.map((balance) => {
    const policyDecision = evaluatePolicy(balance, policy)
    const robotDecision = workerDecision({ balance, policy })
    const postActionBalance =
      robotDecision.action === 'top_up'
        ? balance + robotDecision.amount
        : robotDecision.action === 'trim'
          ? balance - robotDecision.amount
          : balance

    return {
      balance,
      policyAction: policyDecision.action,
      robotAction: robotDecision.action,
      policyAmount: policyDecision.amount,
      robotAmount: robotDecision.amount,
      postActionBalance,
    }
  })
  const decisionMismatches = sweepRows.filter(
    (row) =>
      row.policyAction !== row.robotAction ||
      Math.abs(row.policyAmount - row.robotAmount) > 1e-9,
  )
  const capViolations = sweepRows.filter(
    (row) => row.robotAmount > policy.maxRebalanceAmount + 1e-9,
  )
  const inBandFalsePositives = sweepRows.filter(
    (row) =>
      row.balance >= policy.minThreshold &&
      row.balance <= policy.targetBalance &&
      row.robotAction !== 'hold',
  )

  const externalFlows = [
    -25, -80, -420, 40, 650, 310, -900, 20, 1000, -1200, 75, 150, 400, -75,
    -600, 30, 250, 700, -1100, 55, 0, 490, -620, 210, 330, -780, 60, 900, -450,
    -100,
  ]
  let runningBalance = policy.targetBalance
  const replay = externalFlows.map((externalFlow, index) => {
    const preActionBalance = Math.max(0, runningBalance + externalFlow)
    const decision = workerDecision({ balance: preActionBalance, policy })
    const postActionBalance =
      decision.action === 'top_up'
        ? preActionBalance + decision.amount
        : decision.action === 'trim'
          ? preActionBalance - decision.amount
          : preActionBalance

    runningBalance = postActionBalance

    return {
      period: index + 1,
      externalFlow,
      preActionBalance,
      action: decision.action,
      amount: decision.amount,
      postActionBalance,
    }
  })
  const actionableReplayRows = replay.filter(
    (row) => row.action === 'top_up' || row.action === 'trim',
  )
  const improvedRows = actionableReplayRows.filter(
    (row) =>
      Math.abs(row.postActionBalance - policy.targetBalance) <
      Math.abs(row.preActionBalance - policy.targetBalance),
  )

  const now = new Date('2026-07-18T12:00:00.000Z')
  const safetyCases = [
    {
      name: 'global pause',
      actual: workerDecision({
        balance: 50,
        policy,
        safety: makeSafety(policy, { globalPaused: true }),
      }).blockers,
      expected: 'GLOBAL_PAUSE',
    },
    {
      name: 'policy pause',
      actual: workerDecision({
        balance: 50,
        policy,
        safety: makeSafety(policy, { policyPaused: true }),
      }).blockers,
      expected: 'POLICY_PAUSE',
    },
    {
      name: 'emergency stop',
      actual: workerDecision({
        balance: 50,
        policy,
        safety: makeSafety(policy, { emergencyStop: true }),
      }).blockers,
      expected: 'EMERGENCY_STOP',
    },
    {
      name: 'daily cap',
      actual: workerDecision({
        balance: 50,
        jobs: [makeJob('confirmed', '2026-07-18T10:00:00.000Z')],
        now,
        policy,
        safety: makeSafety(policy, { dailyNotionalCapUsdc: 100 }),
      }).blockers,
      expected: 'DAILY_NOTIONAL_CAP_REACHED',
    },
    {
      name: 'cooldown',
      actual: workerDecision({
        balance: 50,
        jobs: [makeJob('confirmed', '2026-07-18T11:55:00.000Z')],
        now,
        policy,
        safety: makeSafety(policy, { cooldownMinutes: 30 }),
      }).blockers,
      expected: 'COOLDOWN_ACTIVE',
    },
    {
      name: 'pending job',
      actual: workerDecision({
        balance: 50,
        jobs: [makeJob('planned', '2026-07-18T11:55:00.000Z')],
        now,
        policy,
      }).blockers,
      expected: 'JOB_ALREADY_PENDING',
    },
    {
      name: 'missing sweep destination',
      actual: workerDecision({
        balance: 700,
        policy,
        safety: makeSafety(policy, {
          destinationAllowlist: [],
          rebalanceDestinationAddress: undefined,
        }),
      }).blockers,
      expected: 'REBALANCE_DESTINATION_MISSING',
    },
    {
      name: 'destination allowlist',
      actual: workerDecision({
        balance: 700,
        policy,
        safety: makeSafety(policy, {
          rebalanceDestinationAddress: alternateDestinationAddress,
        }),
      }).blockers,
      expected: 'DESTINATION_NOT_ALLOWLISTED',
    },
    {
      name: 'zero execution cap',
      actual: workerDecision({
        balance: 50,
        policy,
        safety: makeSafety(policy, { maxExecutionAmountUsdc: 0 }),
      }).blockers,
      expected: 'MAX_EXECUTION_AMOUNT',
    },
  ].map((testCase) => ({
    ...testCase,
    passed: testCase.actual.includes(testCase.expected),
  }))

  return {
    generatedAt: new Date().toISOString(),
    methodology: {
      historicalDataUsed: false,
      note: 'Deterministic balance sweep and synthetic cash-flow stress replay; no historical treasury dataset was available.',
      transactionsSubmitted: 0,
    },
    policy,
    balanceSweep: {
      cases: sweepRows.length,
      decisionAgreementRate:
        (sweepRows.length - decisionMismatches.length) / sweepRows.length,
      decisionMismatches: decisionMismatches.length,
      capViolations: capViolations.length,
      inBandFalsePositives: inBandFalsePositives.length,
    },
    stressReplay: {
      periods: replay.length,
      topUps: replay.filter((row) => row.action === 'top_up').length,
      trims: replay.filter((row) => row.action === 'trim').length,
      holds: replay.filter((row) => row.action === 'hold').length,
      blocked: replay.filter((row) => row.action === 'blocked').length,
      totalTurnoverUsdc: actionableReplayRows.reduce(
        (total, row) => total + row.amount,
        0,
      ),
      targetDistanceImprovementRate:
        actionableReplayRows.length === 0
          ? 1
          : improvedRows.length / actionableReplayRows.length,
      endingBalanceUsdc: runningBalance,
    },
    safetyGates: {
      cases: safetyCases.length,
      passed: safetyCases.filter((testCase) => testCase.passed).length,
      failed: safetyCases.filter((testCase) => !testCase.passed),
    },
  }
}

export function formatBacktestReport(report: BacktestReport) {
  const percentage = (value: number) => `${(value * 100).toFixed(2)}%`

  return [
    '# Arc Treasury Robot Backtest',
    '',
    `Policy: min ${report.policy.minThreshold} / target ${report.policy.targetBalance} / max ${report.policy.maxRebalanceAmount} USDC`,
    `Method: ${report.methodology.note}`,
    '',
    '## Balance sweep',
    `- Cases: ${report.balanceSweep.cases}`,
    `- Decision agreement: ${percentage(report.balanceSweep.decisionAgreementRate)}`,
    `- Decision mismatches: ${report.balanceSweep.decisionMismatches}`,
    `- Cap violations: ${report.balanceSweep.capViolations}`,
    `- In-band false positives: ${report.balanceSweep.inBandFalsePositives}`,
    '',
    '## Stress replay',
    `- Periods: ${report.stressReplay.periods}`,
    `- Actions: ${report.stressReplay.topUps} top-ups / ${report.stressReplay.trims} trims / ${report.stressReplay.holds} holds / ${report.stressReplay.blocked} blocked`,
    `- Turnover: ${report.stressReplay.totalTurnoverUsdc.toFixed(2)} USDC`,
    `- Target-distance improvement: ${percentage(report.stressReplay.targetDistanceImprovementRate)}`,
    `- Ending balance: ${report.stressReplay.endingBalanceUsdc.toFixed(2)} USDC`,
    '',
    '## Safety gates',
    `- Passed: ${report.safetyGates.passed}/${report.safetyGates.cases}`,
    `- Failed: ${report.safetyGates.failed.length}`,
    '',
    `Transactions submitted: ${report.methodology.transactionsSubmitted}`,
  ].join('\n')
}
