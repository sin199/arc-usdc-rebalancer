import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildLiveExecutionMessage,
  hashLiveExecutionPayload,
} from '../lib/live-execution-auth'

test('payload hashes are stable across object key order', () => {
  const first = hashLiveExecutionPayload({
    accountType: 'EOA',
    blockchain: 'ARC-TESTNET',
    walletSetId: null,
  })
  const second = hashLiveExecutionPayload({
    walletSetId: null,
    blockchain: 'ARC-TESTNET',
    accountType: 'EOA',
  })

  assert.equal(first, second)
})

test('authorization message binds the sensitive action and payload', () => {
  const payloadHash = hashLiveExecutionPayload({
    accountType: 'EOA',
    blockchain: 'ARC-TESTNET',
  })
  const message = buildLiveExecutionMessage({
    kind: 'create_circle_wallet',
    operatorAddress: '0x0000000000000000000000000000000000000001',
    origin: 'https://web-eight-chi-99.vercel.app',
    payloadHash,
    requestId: 'architect-test-request',
    timestamp: 1_752_814_800_000,
  })

  assert.match(message, /Version: 2/)
  assert.match(message, /Kind: create_circle_wallet/)
  assert.match(message, new RegExp(`Payload hash: ${payloadHash}`))
  assert.match(message, /Signing authorizes one Arc Testnet request/)
})
