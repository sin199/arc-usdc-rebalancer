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

test('retry input is finite, integral, and always bounded', async () => {
  let fractionalCalls = 0

  await assert.rejects(
    withBoundedRetry(
      async () => {
        fractionalCalls += 1
        throw new Error('unavailable')
      },
      { attempts: 2.9, sleep: async () => undefined },
    ),
  )

  assert.equal(fractionalCalls, 2)

  let nonFiniteCalls = 0
  await assert.rejects(
    withBoundedRetry(
      async () => {
        nonFiniteCalls += 1
        throw new Error('unavailable')
      },
      { attempts: Number.POSITIVE_INFINITY, sleep: async () => undefined },
    ),
  )

  assert.equal(nonFiniteCalls, 3)

  let largeFiniteCalls = 0
  const liveResult = await withBoundedRetry(
    async () => {
      largeFiniteCalls += 1
      if (largeFiniteCalls < 3) {
        throw new Error('unavailable')
      }
      return 'live'
    },
    { attempts: 1_000_000, sleep: async () => undefined },
  )

  assert.equal(liveResult, 'live')
  assert.equal(largeFiniteCalls, 3)
})

test('retry continues when an optional delay hook fails', async () => {
  let calls = 0

  const result = await withBoundedRetry(
    async () => {
      calls += 1
      if (calls < 3) {
        throw new Error('RPC unavailable')
      }
      return 'live'
    },
    {
      attempts: 3,
      sleep: async () => {
        throw new Error('test scheduler unavailable')
      },
    },
  )

  assert.equal(result, 'live')
  assert.equal(calls, 3)
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

test('cache bookkeeping failures do not hide a live RPC read', async () => {
  const result = await readWithSnapshotFallback({
    label: 'Treasury policy',
    now: () => new Date('2026-07-21T00:00:00.000Z'),
    operation: async () => 500,
    updateCache: () => {
      throw new Error('cache unavailable')
    },
  })

  assert.equal(result.value, 500)
  assert.equal(result.status, 'live')
  assert.equal(result.observedAt, '2026-07-21T00:00:00.000Z')
  assert.ok(result.warning)
  assert.match(result.warning, /live read succeeded, but the cache was not updated/)
})

test('async cache bookkeeping failures do not become unhandled rejections', async () => {
  const result = await readWithSnapshotFallback({
    label: 'Treasury policy',
    now: () => new Date('2026-07-21T00:00:00.000Z'),
    operation: async () => 500,
    updateCache: async () => {
      throw new Error('cache unavailable')
    },
  })

  assert.equal(result.status, 'live')
  assert.ok(result.warning)
  assert.match(result.warning, /live read succeeded, but the cache was not updated/)
})
