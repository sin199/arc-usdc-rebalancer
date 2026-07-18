import 'server-only'

import { Redis } from '@upstash/redis'

type ReplayState = {
  rateWindows: Map<string, number[]>
  usedRequestIds: Map<string, number>
}

type ReplayGlobal = typeof globalThis & {
  __arcLiveExecutionReplayState?: ReplayState
  __arcLiveExecutionRedis?: Redis
}

export type LiveExecutionGuardMode = 'redis' | 'memory' | 'unavailable'

export type ReservationResult =
  | { ok: true; mode: Exclude<LiveExecutionGuardMode, 'unavailable'> }
  | { ok: false; reason: 'rate_limited' | 'replayed' | 'unavailable' }

const replayGlobal = globalThis as ReplayGlobal
const memoryState: ReplayState =
  replayGlobal.__arcLiveExecutionReplayState ??
  (replayGlobal.__arcLiveExecutionReplayState = {
    rateWindows: new Map(),
    usedRequestIds: new Map(),
  })

function redisConfigured() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL?.trim() &&
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim(),
  )
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
  if (!redisConfigured()) {
    return null
  }

  if (!replayGlobal.__arcLiveExecutionRedis) {
    replayGlobal.__arcLiveExecutionRedis = Redis.fromEnv()
  }

  return replayGlobal.__arcLiveExecutionRedis
}

function cleanupMemoryState(now: number, ttlMs: number) {
  for (const [requestId, usedAt] of memoryState.usedRequestIds) {
    if (now - usedAt > ttlMs) {
      memoryState.usedRequestIds.delete(requestId)
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
}): Promise<ReservationResult> {
  const redis = getRedis()
  if (!redis) {
    return { ok: false, reason: 'unavailable' }
  }

  const namespace =
    process.env.LIVE_EXECUTION_REDIS_NAMESPACE?.trim() || 'arc-usdc-rebalancer'
  const requestKey = `${namespace}:request:${params.requestId}`
  const requestTtlMs = Math.max(params.ttlMs * 2, 120_000)
  const reserved = await redis.set(requestKey, params.now, {
    nx: true,
    px: requestTtlMs,
  })

  if (reserved !== 'OK') {
    return { ok: false, reason: 'replayed' }
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

  return { ok: true, mode: 'redis' }
}

function reserveWithMemory(params: {
  now: number
  operatorKey: string
  rateLimit: number
  requestId: string
  ttlMs: number
}): ReservationResult {
  cleanupMemoryState(params.now, Math.max(params.ttlMs * 2, 120_000))

  if (memoryState.usedRequestIds.has(params.requestId)) {
    return { ok: false, reason: 'replayed' }
  }

  const attempts = memoryState.rateWindows.get(params.operatorKey) ?? []
  memoryState.usedRequestIds.set(params.requestId, params.now)
  memoryState.rateWindows.set(params.operatorKey, [...attempts, params.now])

  if (attempts.length >= params.rateLimit) {
    return { ok: false, reason: 'rate_limited' }
  }

  return { ok: true, mode: 'memory' }
}

export async function reserveLiveExecutionRequest(params: {
  now: number
  operatorKey: string
  rateLimit: number
  requestId: string
  ttlMs: number
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
