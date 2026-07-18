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
      guardMode: status.guardMode,
      maxAmountUsdc: status.maxAmountUsdc,
    },
    {
      headers: {
        'cache-control': 'no-store',
      },
    },
  )
}
