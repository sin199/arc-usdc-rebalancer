import { NextRequest, NextResponse } from 'next/server'
import { readTreasuryHistory } from '@/lib/treasury-history-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  const limit = Number(request.nextUrl.searchParams.get('limit') ?? 96)

  try {
    const history = await readTreasuryHistory(limit)
    return NextResponse.json(history, {
      headers: { 'cache-control': 'no-store' },
    })
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Treasury history is unavailable.'
    return NextResponse.json(
      { configured: true, count: 0, error: message, points: [] },
      { status: 503 },
    )
  }
}
