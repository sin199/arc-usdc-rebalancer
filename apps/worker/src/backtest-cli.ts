import { formatBacktestReport, runTreasuryRobotBacktest } from './backtest'

const report = runTreasuryRobotBacktest()

if (process.argv.includes('--json')) {
  console.log(JSON.stringify(report, null, 2))
} else {
  console.log(formatBacktestReport(report))
}

if (
  report.balanceSweep.decisionMismatches > 0 ||
  report.balanceSweep.capViolations > 0 ||
  report.balanceSweep.inBandFalsePositives > 0 ||
  report.stressReplay.blocked > 0 ||
  report.safetyGates.failed.length > 0
) {
  process.exitCode = 1
}
