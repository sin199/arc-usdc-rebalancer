import { errorResponse, json } from '@/app/api/_lib'
import { getRobotRuntime } from '@/lib/robot-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as {
      jobType: 'rebalance' | 'wallet-top-up' | 'payout-batch' | 'treasury-sweep'
      amountUsdc: number
      destinationAddress: `0x${string}`
      executionMode: 'dry-run' | 'manual-approve' | 'auto'
      notes?: string
    }

    const { engine } = await getRobotRuntime()
    return json(await engine.createJob({
      type: body.jobType,
      amountUsdc: Number(body.amountUsdc),
      destinationAddress: body.destinationAddress,
      executionMode: body.executionMode,
      notes: body.notes,
    }), { status: 201 })
  } catch (error) {
    return errorResponse(error)
  }
}
