import { NextRequest, NextResponse } from 'next/server'
import { isAddress } from 'viem'
import { runTreasuryExecution, type TreasuryExecutionAction } from '@/lib/treasury-execution-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function parseAction(value: unknown): TreasuryExecutionAction | null {
  return value === 'top_up' || value === 'trim' ? value : null
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as {
      action?: unknown
      amountUsdc?: unknown
      recipient?: unknown
    }

    const action = parseAction(body.action)
    const amountUsdc = Number(body.amountUsdc)
    const recipient =
      typeof body.recipient === 'string' && isAddress(body.recipient.trim())
        ? (body.recipient.trim() as `0x${string}`)
        : undefined

    if (!action) {
      return NextResponse.json({ error: 'Invalid or missing execution action.' }, { status: 400 })
    }

    if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
      return NextResponse.json({ error: 'Execution amount must be a positive number.' }, { status: 400 })
    }

    const result = await runTreasuryExecution({
      action,
      amountUsdc,
      recipient,
    })

    return NextResponse.json(result, {
      headers: {
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown treasury execution error.'
    const status = /missing|mismatch|invalid/i.test(message) ? 400 : 500

    return NextResponse.json({ error: message }, { status })
  }
}
