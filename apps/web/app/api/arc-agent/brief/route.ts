import { NextRequest, NextResponse } from 'next/server'
import { runArcAgentBrief } from '@/lib/arc-agent-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(request: NextRequest) {
  try {
    const searchParams = request.nextUrl.searchParams
    const requestHash = searchParams.get('requestHash')?.trim() || undefined

    const brief = await runArcAgentBrief(
      requestHash?.startsWith('0x') ? (requestHash as `0x${string}`) : undefined,
    )

    return NextResponse.json(brief, {
      headers: {
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Arc agent brief error.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
