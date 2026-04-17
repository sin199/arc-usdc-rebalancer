import { errorResponse, json } from '@/app/api/_lib'
import { getRobotRuntime } from '@/lib/robot-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const { engine } = await getRobotRuntime()
    const state = await engine.getState()
    return json(state.jobs)
  } catch (error) {
    return errorResponse(error)
  }
}

export async function POST(request: Request) {
  try {
    const body = (await request.json().catch(() => ({}))) as { triggerSource?: string }
    const triggerSource =
      body.triggerSource === 'manual' || body.triggerSource === 'approval' || body.triggerSource === 'startup'
        ? body.triggerSource
        : 'schedule'

    const { engine } = await getRobotRuntime()
    return json(await engine.refreshSnapshot(triggerSource))
  } catch (error) {
    return errorResponse(error)
  }
}
