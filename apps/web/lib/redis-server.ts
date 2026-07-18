import 'server-only'

import { Redis } from '@upstash/redis'

type RedisGlobal = typeof globalThis & {
  __arcRedisClient?: Redis
}

const redisGlobal = globalThis as RedisGlobal

export function getRedisCredentials() {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim()
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim()

  return url && token ? { token, url } : null
}

export function getRedisClient() {
  const credentials = getRedisCredentials()
  if (!credentials) {
    return null
  }

  if (!redisGlobal.__arcRedisClient) {
    redisGlobal.__arcRedisClient = new Redis(credentials)
  }

  return redisGlobal.__arcRedisClient
}
