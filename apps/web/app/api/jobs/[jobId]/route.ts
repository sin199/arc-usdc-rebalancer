import { errorResponse, json } from '@/app/api/_lib'
import { getRobotRuntime } from '@/lib/robot-server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export async function GET(_: Request, context: { params: Promise<{ jobId: string }> }) {
  try {
    const { jobId } = await context.params
    const { engine } = await getRobotRuntime()
    const job = await engine.getJob(decodeURIComponent(jobId))

    if (!job) {
      return json({ error: 'Job not found' }, { status: 404 })
    }

    return json(job)
  } catch (error) {
    return errorResponse(error)
  }
}
