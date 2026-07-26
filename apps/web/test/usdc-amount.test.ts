import assert from 'node:assert/strict'
import test from 'node:test'
import { parseUsdcAmount } from '../lib/usdc-amount'

test('USDC amounts use canonical six-decimal units', () => {
  const parsed = parseUsdcAmount('12.340001')
  assert.equal(parsed.canonical, '12.340001')
  assert.equal(parsed.amountUnits, 12_340_001n)
})

test('USDC amounts reject excess precision and zero execution values', () => {
  assert.throws(() => parseUsdcAmount('1.0000001'), /at most 6 fractional digits/)
  assert.throws(() => parseUsdcAmount('0'), /greater than zero/)
  assert.equal(parseUsdcAmount('0', 'USDC amount', true).canonical, '0')
})
