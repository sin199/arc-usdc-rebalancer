import { NextResponse } from 'next/server'
import { getLiveExecutionStatus } from '@/lib/live-execution-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET() {
  const status = getLiveExecutionStatus()

  return NextResponse.json(
    {
      authorization: status.authorization,
      enabled: status.enabled,
      enabledByFlag: status.enabledByFlag,
      guardMode: status.guardMode,
      legacyExecutorWired: status.legacyExecutorWired,
      maxAmountUsdc: status.maxAmountUsdc,
    },
    {
      headers: {
        'cache-control': 'no-store',
      },
    },
  )
}
