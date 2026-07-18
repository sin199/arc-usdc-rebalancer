import assert from 'node:assert/strict'
import test from 'node:test'
import {
  conciseRpcError,
  readWithSnapshotFallback,
  withBoundedRetry,
  type Snapshot,
} from '../lib/rpc-resilience'

test('bounded retry succeeds on the third attempt', async () => {
  let calls = 0
  const delays: number[] = []

  const result = await withBoundedRetry(
    async () => {
      calls += 1
      if (calls < 3) {
        throw new Error('request limit reached')
      }
      return 'live'
    },
    {
      attempts: 3,
      delaysMs: [10, 20],
      sleep: async (delayMs) => {
        delays.push(delayMs)
      },
    },
  )

  assert.equal(result, 'live')
  assert.equal(calls, 3)
  assert.deepEqual(delays, [10, 20])
})

test('bounded retry stops after the configured attempts', async () => {
  let calls = 0

  await assert.rejects(
    withBoundedRetry(
      async () => {
        calls += 1
        throw new Error('still unavailable')
      },
      { attempts: 2, sleep: async () => undefined },
    ),
    /still unavailable/,
  )

  assert.equal(calls, 2)
})

test('RPC rate-limit errors are safe and concise', () => {
  assert.equal(
    conciseRpcError(
      new Error('RPC Request failed.\nDetails: request limit reached'),
    ),
    'Arc Testnet RPC rate limit reached.',
  )
})

test('stale cache fallback is returned and clearly marked', async () => {
  const cached: Snapshot<number> = {
    value: 500,
    observedAt: '2026-07-18T04:00:00.000Z',
  }

  const result = await readWithSnapshotFallback({
    cached,
    label: 'Treasury policy',
    operation: async () => {
      throw new Error('request limit reached')
    },
    retry: { attempts: 1 },
    updateCache: () => assert.fail('failed reads must not replace the cache'),
  })

  assert.equal(result.value, 500)
  assert.equal(result.status, 'cached')
  assert.equal(result.observedAt, cached.observedAt)
  assert.match(result.warning, /cached snapshot from 2026-07-18T04:00:00.000Z/)
})
