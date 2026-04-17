import { errorResponse, json } from '@/app/api/_lib'
import { getRobotRuntime } from '@/lib/robot-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET() {
  try {
    const { engine } = await getRobotRuntime()
    return json(await engine.getState())
  } catch (error) {
    return errorResponse(error)
  }
}
