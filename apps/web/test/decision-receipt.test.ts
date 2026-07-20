import assert from 'node:assert/strict'
import test from 'node:test'
import { buildTreasuryDecisionReceipt } from '@arc-usdc-rebalancer/shared'

const input = {
  action: 'top_up' as const,
  amountUsdc: 200,
  balanceUsdc: 0,
  chainId: 5042002,
  executorAddress: '0x5c5d0275371724779f3a6928eb0312df2b1a501f',
  observedAt: '2026-07-20T14:00:00.000Z',
  policy: {
    maxRebalanceAmount: 200,
    minThreshold: 100,
    targetBalance: 500,
  },
  policyAddress: '0x4bFa1e67B1163B452d39f27F799B0A7D28F545f6',
}

test('treasury decision receipts are deterministic and bind their decision', () => {
  const first = buildTreasuryDecisionReceipt(input)
  const second = buildTreasuryDecisionReceipt(input)
  const changed = buildTreasuryDecisionReceipt({ ...input, amountUsdc: 199 })

  assert.equal(first.receiptHash, second.receiptHash)
  assert.notEqual(first.receiptHash, changed.receiptHash)
  assert.equal(first.amountUsdc, '200000000')
  assert.equal(first.observedAtUnix, '1784556000')
})

test('treasury decision receipts reject invalid factual inputs', () => {
  assert.throws(
    () => buildTreasuryDecisionReceipt({ ...input, balanceUsdc: -1 }),
    /non-negative finite/i,
  )
  assert.throws(
    () => buildTreasuryDecisionReceipt({ ...input, observedAt: 'not-a-date' }),
    /valid ISO/i,
  )
})
