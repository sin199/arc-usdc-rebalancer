import { NextResponse } from 'next/server'
import { runTreasuryRobotBacktest } from '@arc-usdc-rebalancer/shared'

export const runtime = 'nodejs'

export async function GET() {
  return NextResponse.json(runTreasuryRobotBacktest(), {
    headers: {
      'cache-control': 'public, s-maxage=3600, stale-while-revalidate=86400',
    },
  })
}
