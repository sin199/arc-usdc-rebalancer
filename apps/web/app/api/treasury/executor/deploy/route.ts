import { NextRequest, NextResponse } from 'next/server'
import { deployTreasuryExecutorServerSide } from '@/lib/treasury-execution-server'
import { auditLiveExecution, authorizeLiveExecution } from '@/lib/live-execution-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      operatorAddress?: unknown
      requestId?: unknown
      timestamp?: unknown
    }
    const operatorAddress = typeof body.operatorAddress === 'string' ? body.operatorAddress.trim() : ''
    const requestId = typeof body.requestId === 'string' ? body.requestId.trim() : ''
    const timestamp = Number(body.timestamp)
    const authorization = await authorizeLiveExecution(request, {
      kind: 'deploy_executor',
      operatorAddress,
      requestId,
      timestamp,
    })

    if (!authorization.ok) {
      return authorization.response
    }

    const result = await deployTreasuryExecutorServerSide()

    auditLiveExecution('treasury_executor_deployed', {
      executorAddress: result.executorAddress,
      requestId: authorization.authorization.requestId,
      txHash: result.txHash,
    })

    return NextResponse.json(result, {
      headers: {
        'cache-control': 'no-store',
        'x-request-id': authorization.authorization.requestId,
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown TreasuryExecutor deployment error.'
    const status = /missing|mismatch|invalid/i.test(message) ? 400 : 500

    return NextResponse.json({ error: message }, { status })
  }
}
