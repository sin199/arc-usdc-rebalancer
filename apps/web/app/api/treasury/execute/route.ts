import { NextRequest, NextResponse } from 'next/server'
import { isAddress } from 'viem'
import {
  runTreasuryExecution,
  type TreasuryExecutionAction,
} from '@/lib/treasury-execution-server'
import {
  auditLiveExecution,
  authorizeLiveExecution,
  type LiveExecutionAuthorization,
} from '@/lib/live-execution-guard'
import { completeLiveExecutionRequest } from '@/lib/live-execution-replay-store'
import { parseUsdcAmount } from '@/lib/usdc-amount'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseAction(value: unknown): TreasuryExecutionAction | null {
  return value === 'top_up' || value === 'trim' ? value : null
}

export async function POST(request: NextRequest) {
  let executionAuthorization: LiveExecutionAuthorization | undefined
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown
      amountUsdc?: unknown
      executorAddress?: unknown
      operatorAddress?: unknown
      requestId?: unknown
      timestamp?: unknown
    }

    const action = parseAction(body.action)
    let amountUsdc: number
    try {
      amountUsdc = parseUsdcAmount(body.amountUsdc).amountUsdc
    } catch (error) {
      return NextResponse.json(
        {
          error:
            error instanceof Error ? error.message : 'Invalid USDC amount.',
        },
        { status: 400 },
      )
    }
    const executorAddress =
      typeof body.executorAddress === 'string' &&
      isAddress(body.executorAddress.trim())
        ? (body.executorAddress.trim() as `0x${string}`)
        : undefined
    const operatorAddress =
      typeof body.operatorAddress === 'string'
        ? body.operatorAddress.trim()
        : ''
    const requestId =
      typeof body.requestId === 'string' ? body.requestId.trim() : ''
    const timestamp = Number(body.timestamp)

    if (!action) {
      return NextResponse.json(
        { error: 'Invalid or missing execution action.' },
        { status: 400 },
      )
    }

    const authorization = await authorizeLiveExecution(request, {
      action,
      amountUsdc,
      executorAddress,
      kind: 'execute',
      operatorAddress,
      requestId,
      timestamp,
    })

    if (!authorization.ok) {
      return authorization.response
    }
    executionAuthorization = authorization.authorization

    const result = await runTreasuryExecution({
      action,
      amountUsdc,
      executorAddress,
      recipient: authorization.authorization.operatorAddress,
    })

    auditLiveExecution('live_execution_completed', {
      action,
      amountUsdc,
      requestId: authorization.authorization.requestId,
      txHash: result.txHashes.execute,
    })

    await completeLiveExecutionRequest({
      requestId: executionAuthorization.requestId,
      fingerprint: executionAuthorization.fingerprint,
      status: 200,
      payload: result,
    })

    return NextResponse.json(result, {
      headers: {
        'cache-control': 'no-store',
        'x-request-id': authorization.authorization.requestId,
      },
    })
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown treasury execution error.'
    const status = /missing|mismatch|invalid/i.test(message) ? 400 : 500

    if (executionAuthorization) {
      try {
        await completeLiveExecutionRequest({
          requestId: executionAuthorization.requestId,
          fingerprint: executionAuthorization.fingerprint,
          status,
          payload: { error: message },
        })
      } catch {
        auditLiveExecution('live_execution_replay_persist_failed', {
          requestId: executionAuthorization.requestId,
        })
      }
    }

    return NextResponse.json({ error: message }, { status })
  }
}
