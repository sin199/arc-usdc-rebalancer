import { NextRequest, NextResponse } from 'next/server'
import { runArcAgentBrief } from '@/lib/arc-agent-server'
import { getLiveExecutionStatus } from '@/lib/live-execution-guard'
import { recordTreasuryHistory } from '@/lib/treasury-history-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

function authorized(request: NextRequest) {
  const secret = process.env.CRON_SECRET?.trim()
  return Boolean(
    secret && request.headers.get('authorization') === `Bearer ${secret}`,
  )
}

export async function GET(request: NextRequest) {
  if (!authorized(request)) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }

  try {
    const brief = await runArcAgentBrief()
    const stored = await recordTreasuryHistory(brief)
    const execution = getLiveExecutionStatus()

    console.info(
      JSON.stringify({
        event: 'treasury_snapshot_collected',
        action: brief.recommendation.action,
        dataQuality: brief.dataQuality.overall,
        executionEnabled: execution.enabled,
        stored: stored.ok,
        timestamp: brief.generatedAt,
      }),
    )

    return NextResponse.json(
      {
        ok: stored.ok,
        action: brief.recommendation.action,
        dataQuality: brief.dataQuality.overall,
        executionEnabled: execution.enabled,
        generatedAt: brief.generatedAt,
        storage: stored.ok ? 'redis' : stored.reason,
      },
      { status: stored.ok ? 200 : 503 },
    )
  } catch (error) {
    const message =
      error instanceof Error ? error.message : 'Treasury snapshot failed.'
    console.error(
      JSON.stringify({ event: 'treasury_snapshot_failed', error: message }),
    )
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
