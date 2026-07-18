import type { ArcAgentBriefResult } from './arc-agent-server'

export type TreasuryHistoryPoint = {
  recordedAt: string
  generatedAt: string
  recommendation: {
    action: ArcAgentBriefResult['recommendation']['action']
    headline: string
  }
  dataQuality: ArcAgentBriefResult['dataQuality']['overall']
  sourceStatus: Record<string, string>
  warnings: string[]
  balanceUsdc: number | null
  policy: ArcAgentBriefResult['treasury']['policy']
  circleWalletCount: number
}

export function parseTreasuryHistoryPoint(
  value: unknown,
): TreasuryHistoryPoint | null {
  try {
    const parsed = (
      typeof value === 'string' ? JSON.parse(value) : value
    ) as Partial<TreasuryHistoryPoint> | null

    return parsed &&
      typeof parsed.recordedAt === 'string' &&
      typeof parsed.generatedAt === 'string' &&
      typeof parsed.recommendation?.action === 'string'
      ? (parsed as TreasuryHistoryPoint)
      : null
  } catch {
    return null
  }
}

export function normalizeTreasuryHistoryLimit(limit: number, fallback = 96) {
  const normalized = Number.isFinite(limit) ? Math.floor(limit) : fallback
  return Math.min(288, Math.max(1, normalized))
}
