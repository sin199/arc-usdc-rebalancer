import { NextRequest, NextResponse } from 'next/server'
import { runArcAgentActivation } from '@/lib/arc-agent-server'
import {
  auditLiveExecution,
  authorizeLiveExecution,
} from '@/lib/live-execution-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      operatorAddress?: unknown
      requestId?: unknown
      timestamp?: unknown
    }
    const operatorAddress =
      typeof body.operatorAddress === 'string'
        ? body.operatorAddress.trim()
        : ''
    const requestId =
      typeof body.requestId === 'string' ? body.requestId.trim() : ''
    const timestamp = Number(body.timestamp)
    const authorization = await authorizeLiveExecution(request, {
      kind: 'activate_agent',
      operatorAddress,
      requestId,
      timestamp,
    })

    if (!authorization.ok) {
      return authorization.response
    }

    const activation = await runArcAgentActivation()

    auditLiveExecution('arc_agent_activated', {
      requestHash: activation.requestHash,
      requestId: authorization.authorization.requestId,
    })

    return NextResponse.json(activation, {
      headers: {
        'cache-control': 'no-store',
        'x-request-id': authorization.authorization.requestId,
      },
    })
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown Arc agent activation error.'

    return NextResponse.json({ error: message }, { status: 500 })
  }
}
