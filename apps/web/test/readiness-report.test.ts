import assert from 'node:assert/strict'
import test from 'node:test'
import { buildReadinessReport } from '../lib/readiness-report'

test('readiness reports disclose the editable balance source', () => {
  const report = buildReadinessReport({
    agentId: '4507',
    agentTag: 'kyc_verified',
    balance: 500,
    circleNotes: [],
    circleReady: false,
    circleSummary: 'Optional crosschain readiness',
    generatedAt: '2026-07-21T00:00:00.000Z',
    liveExecutionEnabled: false,
    liveMode: false,
    modeLabel: 'Preview mode',
    policy: {
      maxRebalanceAmount: 200,
      minThreshold: 100,
      targetBalance: 500,
    },
    policySourceLabel: 'Draft policy',
  })

  assert.match(
    report.markdown,
    /Balance source: Editable scenario input; not the live executor balance/i,
  )
  assert.ok(
    report.evidence.some(
      (item) =>
        item.label === 'Balance source' &&
        item.value ===
          'Editable scenario input; not the live executor balance shown in the Treasury Brief.',
    ),
  )
})
