import { NextResponse } from 'next/server'
import { runArcAgentActivation } from '@/lib/arc-agent-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const activation = await runArcAgentActivation()

    return NextResponse.json(activation, {
      headers: {
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Arc agent activation error.'

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
