import { errorResponse, json } from '@/app/api/_lib'
import { getRobotRuntime } from '@/lib/robot-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function POST(_: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await context.params
    const { engine } = await getRobotRuntime()
    return json(await engine.rejectJob(decodeURIComponent(jobId)))
  } catch (error) {
    return errorResponse(error)
  }
}
