import assert from 'node:assert/strict'
import test from 'node:test'
import {
  normalizeTreasuryHistoryLimit,
  parseTreasuryHistoryPoint,
  type TreasuryHistoryPoint,
} from '../lib/treasury-history'

const point: TreasuryHistoryPoint = {
  balanceUsdc: 500,
  circleWalletCount: 1,
  dataQuality: 'live',
  generatedAt: '2026-07-18T04:00:00.000Z',
  policy: {
    maxRebalanceAmount: 200,
    minThreshold: 100,
    targetBalance: 500,
  },
  recommendation: {
    action: 'hold',
    headline: 'Treasury is within policy.',
  },
  recordedAt: '2026-07-18T04:00:01.000Z',
  sourceStatus: { treasuryBalance: 'live' },
  warnings: [],
}

test('history parser accepts raw Redis strings and auto-deserialized members', () => {
  assert.deepEqual(parseTreasuryHistoryPoint(JSON.stringify(point)), point)
  assert.deepEqual(parseTreasuryHistoryPoint(point), point)
  assert.equal(
    parseTreasuryHistoryPoint({ generatedAt: point.generatedAt }),
    null,
  )
})

test('history limit is bounded and rejects non-finite input', () => {
  assert.equal(normalizeTreasuryHistoryLimit(Number.NaN), 96)
  assert.equal(normalizeTreasuryHistoryLimit(0), 1)
  assert.equal(normalizeTreasuryHistoryLimit(24.9), 24)
  assert.equal(normalizeTreasuryHistoryLimit(10_000), 288)
})
