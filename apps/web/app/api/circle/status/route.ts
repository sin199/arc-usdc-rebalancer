import { NextRequest, NextResponse } from 'next/server'
import { fetchCircleControlPlaneStatus } from '@/lib/circle-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const walletSetId = searchParams.get('walletSetId')?.trim() || undefined
    const depositor = searchParams.get('depositor')?.trim() || undefined

    const status = await fetchCircleControlPlaneStatus({
      depositor,
      walletSetId,
    })

    return NextResponse.json(status, {
      headers: {
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Circle status error.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
