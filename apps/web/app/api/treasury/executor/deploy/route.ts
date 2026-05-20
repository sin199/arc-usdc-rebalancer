import { NextResponse } from 'next/server'
import { deployTreasuryExecutorServerSide } from '@/lib/treasury-execution-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST() {
  try {
    const result = await deployTreasuryExecutorServerSide()

    return NextResponse.json(result, {
      headers: {
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown TreasuryExecutor deployment error.'
    const status = /missing|mismatch|invalid/i.test(message) ? 400 : 500

    return NextResponse.json({ error: message }, { status })
  }
}
