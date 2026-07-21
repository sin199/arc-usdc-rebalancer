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
  policySource: 'live' as const,
}

test('treasury decision receipts are deterministic and bind their decision', () => {
  const first = buildTreasuryDecisionReceipt(input)
  const second = buildTreasuryDecisionReceipt(input)
  const changed = buildTreasuryDecisionReceipt({ ...input, amountUsdc: 199 })
  const draft = buildTreasuryDecisionReceipt({ ...input, policySource: 'draft' })
  const nextMillisecond = buildTreasuryDecisionReceipt({
    ...input,
    observedAt: '2026-07-20T14:00:00.001Z',
  })

  assert.equal(first.receiptHash, second.receiptHash)
  assert.notEqual(first.receiptHash, changed.receiptHash)
  assert.notEqual(first.receiptHash, draft.receiptHash)
  assert.notEqual(first.receiptHash, nextMillisecond.receiptHash)
  assert.equal(first.amountUsdc, '200000000')
  assert.equal(first.observedAtMs, '1784556000000')
  assert.equal(first.observedAtUnix, '1784556000')
  assert.equal(first.policySource, 'live')
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
  assert.throws(
    () =>
      buildTreasuryDecisionReceipt({
        ...input,
        executorAddress: 'not-an-address',
      }),
    /non-zero EVM address/i,
  )
  assert.throws(
    () =>
      buildTreasuryDecisionReceipt({
        ...input,
        policyAddress: '',
      }),
    /non-zero EVM address/i,
  )
})
