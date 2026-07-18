import assert from 'node:assert/strict'
import test from 'node:test'
import { runTreasuryRobotBacktest } from '@arc-usdc-rebalancer/shared'

test('treasury robot passes deterministic backtest invariants', () => {
  const report = runTreasuryRobotBacktest()

  assert.equal(report.methodology.transactionsSubmitted, 0)
  assert.equal(report.balanceSweep.decisionMismatches, 0)
  assert.equal(report.balanceSweep.capViolations, 0)
  assert.equal(report.balanceSweep.inBandFalsePositives, 0)
  assert.equal(report.stressReplay.blocked, 0)
  assert.equal(report.stressReplay.targetDistanceImprovementRate, 1)
  assert.equal(report.safetyGates.failed.length, 0)
  assert.equal(report.safetyGates.passed, report.safetyGates.cases)
})
