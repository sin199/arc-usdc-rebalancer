import 'server-only'

import { getRedisClient, getRedisCredentials } from './redis-server'

type ReplayState = {
  rateWindows: Map<string, number[]>
  requests: Map<string, ReplayRecord>
}

type ReplayGlobal = typeof globalThis & {
  __arcLiveExecutionReplayState?: ReplayState
}

export type LiveExecutionGuardMode = 'redis' | 'memory' | 'unavailable'

export type ReplayRecord = {
  fingerprint: string
  status: 'reserved' | 'submitting' | 'completed' | 'failed'
  createdAt: number
  response?: {
    status: number
    payload: unknown
  }
}

export type ReservationResult =
  | { ok: true; mode: Exclude<LiveExecutionGuardMode, 'unavailable'> }
  | {
      ok: false
      reason: 'rate_limited' | 'replayed' | 'unavailable'
      record?: ReplayRecord
    }

const replayGlobal = globalThis as ReplayGlobal
const memoryState: ReplayState =
  replayGlobal.__arcLiveExecutionReplayState ??
  (replayGlobal.__arcLiveExecutionReplayState = {
    rateWindows: new Map(),
    requests: new Map(),
  })

function redisConfigured() {
  return Boolean(getRedisCredentials())
}

function memoryGuardAllowed() {
  return (
    process.env.NODE_ENV !== 'production' &&
    process.env.LIVE_EXECUTION_ALLOW_IN_MEMORY_GUARD === 'true'
  )
}

export function getLiveExecutionGuardMode(): LiveExecutionGuardMode {
  if (redisConfigured()) {
    return 'redis'
  }

  return memoryGuardAllowed() ? 'memory' : 'unavailable'
}

function getRedis() {
  return getRedisClient()
}

function cleanupMemoryState(now: number, ttlMs: number) {
  for (const [requestId, record] of memoryState.requests) {
    if (now - record.createdAt > ttlMs) {
      memoryState.requests.delete(requestId)
    }
  }

  for (const [operator, attempts] of memoryState.rateWindows) {
    const recent = attempts.filter((attempt) => now - attempt < 60_000)
    if (recent.length === 0) {
      memoryState.rateWindows.delete(operator)
    } else {
      memoryState.rateWindows.set(operator, recent)
    }
  }
}

async function reserveWithRedis(params: {
  now: number
  operatorKey: string
  rateLimit: number
  requestId: string
  ttlMs: number
  fingerprint: string
}): Promise<ReservationResult> {
  const redis = getRedis()
  if (!redis) {
    return { ok: false, reason: 'unavailable' }
  }

  const namespace =
    process.env.LIVE_EXECUTION_REDIS_NAMESPACE?.trim() || 'arc-usdc-rebalancer'
  const requestKey = `${namespace}:request:${params.requestId}`
  const requestTtlMs = Math.max(params.ttlMs * 2, 120_000)
  const existingValue = await redis.get<string>(requestKey)
  if (existingValue) {
    return {
      ok: false,
      reason: 'replayed',
      record: parseReplayRecord(existingValue),
    }
  }

  const rateBucket = Math.floor(params.now / 60_000)
  const rateKey = `${namespace}:rate:${params.operatorKey}:${rateBucket}`
  const attempts = await redis.incr(rateKey)
  if (attempts === 1) {
    await redis.expire(rateKey, 120)
  }

  if (attempts > params.rateLimit) {
    return { ok: false, reason: 'rate_limited' }
  }

  const record: ReplayRecord = {
    fingerprint: params.fingerprint,
    status: 'submitting',
    createdAt: params.now,
  }
  const reserved = await redis.set(requestKey, JSON.stringify(record), {
    nx: true,
    px: requestTtlMs,
  })

  if (reserved !== 'OK') {
    const racedValue = await redis.get<string>(requestKey)
    return {
      ok: false,
      reason: 'replayed',
      record: racedValue ? parseReplayRecord(racedValue) : undefined,
    }
  }

  return { ok: true, mode: 'redis' }
}

function reserveWithMemory(params: {
  now: number
  operatorKey: string
  rateLimit: number
  requestId: string
  ttlMs: number
  fingerprint: string
}): ReservationResult {
  cleanupMemoryState(params.now, Math.max(params.ttlMs * 2, 120_000))

  const existing = memoryState.requests.get(params.requestId)
  if (existing) {
    return { ok: false, reason: 'replayed', record: existing }
  }

  const attempts = memoryState.rateWindows.get(params.operatorKey) ?? []
  if (attempts.length >= params.rateLimit) {
    return { ok: false, reason: 'rate_limited' }
  }

  memoryState.requests.set(params.requestId, {
    fingerprint: params.fingerprint,
    status: 'submitting',
    createdAt: params.now,
  })
  memoryState.rateWindows.set(params.operatorKey, [...attempts, params.now])

  return { ok: true, mode: 'memory' }
}

export async function reserveLiveExecutionRequest(params: {
  now: number
  operatorKey: string
  rateLimit: number
  requestId: string
  ttlMs: number
  fingerprint: string
}): Promise<ReservationResult> {
  const mode = getLiveExecutionGuardMode()

  if (mode === 'redis') {
    try {
      return await reserveWithRedis(params)
    } catch {
      return { ok: false, reason: 'unavailable' }
    }
  }

  if (mode === 'memory') {
    return reserveWithMemory(params)
  }

  return { ok: false, reason: 'unavailable' }
}

function parseReplayRecord(value: string): ReplayRecord | undefined {
  try {
    const parsed = JSON.parse(value) as ReplayRecord
    if (
      typeof parsed.fingerprint === 'string' &&
      (parsed.status === 'reserved' ||
        parsed.status === 'submitting' ||
        parsed.status === 'completed' ||
        parsed.status === 'failed') &&
      typeof parsed.createdAt === 'number'
    ) {
      return parsed
    }
  } catch {
    // Treat malformed durable state as an unavailable replay record.
  }

  return undefined
}

export async function completeLiveExecutionRequest(params: {
  requestId: string
  fingerprint: string
  status: number
  payload: unknown
}) {
  const mode = getLiveExecutionGuardMode()
  const response = { status: params.status, payload: params.payload }
  const record: ReplayRecord = {
    fingerprint: params.fingerprint,
    status: 'completed',
    createdAt: Date.now(),
    response,
  }

  if (mode === 'redis') {
    const redis = getRedis()
    if (!redis) {
      throw new Error(
        'Durable live execution replay protection is unavailable.',
      )
    }
    const namespace =
      process.env.LIVE_EXECUTION_REDIS_NAMESPACE?.trim() ||
      'arc-usdc-rebalancer'
    const requestKey = `${namespace}:request:${params.requestId}`
    const currentValue = await redis.get<string>(requestKey)
    const current = currentValue ? parseReplayRecord(currentValue) : undefined
    if (!current || current.fingerprint !== params.fingerprint) {
      throw new Error('Live execution replay record ownership mismatch.')
    }
    if (current.status === 'completed') {
      return
    }
    await redis.set(
      `${namespace}:request:${params.requestId}`,
      JSON.stringify(record),
      {
        px: 120_000,
      },
    )
    return
  }

  if (mode === 'memory') {
    const current = memoryState.requests.get(params.requestId)
    if (!current || current.fingerprint !== params.fingerprint) {
      throw new Error('Live execution replay record ownership mismatch.')
    }
    if (current.status === 'completed') {
      return
    }
    memoryState.requests.set(params.requestId, record)
    return
  }

  throw new Error('Durable live execution replay protection is unavailable.')
}
