import 'server-only'

import type { ArcAgentBriefResult } from './arc-agent-server'
import { getRedisClient } from './redis-server'
import {
  normalizeTreasuryHistoryLimit,
  parseTreasuryHistoryPoint,
  type TreasuryHistoryPoint,
} from './treasury-history'

export type { TreasuryHistoryPoint } from './treasury-history'

const historyKey = `${process.env.TREASURY_HISTORY_NAMESPACE?.trim() || 'arc-usdc-rebalancer'}:history:snapshots`
const maxHistoryPoints = 8_640

export function buildTreasuryHistoryPoint(
  brief: ArcAgentBriefResult,
  recordedAt = new Date().toISOString(),
): TreasuryHistoryPoint {
  return {
    balanceUsdc: brief.treasury.balanceUsdc ?? null,
    circleWalletCount: brief.circle.walletCount,
    dataQuality: brief.dataQuality.overall,
    generatedAt: brief.generatedAt,
    policy: brief.treasury.policy,
    recommendation: {
      action: brief.recommendation.action,
      headline: brief.recommendation.headline,
    },
    recordedAt,
    sourceStatus: Object.fromEntries(
      Object.entries(brief.dataQuality.sources).map(([name, source]) => [
        name,
        source.status,
      ]),
    ),
    warnings: brief.warnings,
  }
}

export async function recordTreasuryHistory(brief: ArcAgentBriefResult) {
  const redis = getRedisClient()
  if (!redis) {
    return { ok: false as const, reason: 'storage_unavailable' as const }
  }

  const point = buildTreasuryHistoryPoint(brief)
  await redis.zadd(historyKey, {
    member: JSON.stringify(point),
    score: Date.parse(point.recordedAt),
  })
  await redis.zremrangebyrank(historyKey, 0, -(maxHistoryPoints + 1))

  return { ok: true as const, point }
}

export async function readTreasuryHistory(limit = 96) {
  const redis = getRedisClient()
  if (!redis) {
    return {
      configured: false,
      count: 0,
      points: [] as TreasuryHistoryPoint[],
    }
  }

  const safeLimit = normalizeTreasuryHistoryLimit(limit)
  const [count, values] = await Promise.all([
    redis.zcard(historyKey),
    redis.zrange<unknown[]>(historyKey, 0, safeLimit - 1, { rev: true }),
  ])
  const points = values
    .map(parseTreasuryHistoryPoint)
    .filter((point): point is TreasuryHistoryPoint => point !== null)

  return {
    configured: true,
    count,
    points,
  }
}
