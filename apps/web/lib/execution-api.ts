import type { RobotRuntimeState, TreasuryJobRecord } from '@arc-usdc-rebalancer/shared'

export const robotApiBaseUrl = process.env.NEXT_PUBLIC_EXECUTION_API_URL?.trim().replace(/\/$/, '') || ''
export const executionApiBaseUrl = robotApiBaseUrl

async function requestRobotApi<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (!robotApiBaseUrl) {
    return null
  }

  const response = await fetch(`${robotApiBaseUrl}${path}`, {
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `Robot API request failed: ${response.status}`)
  }

  return (await response.json()) as T
}

export async function fetchRobotStatus(): Promise<RobotRuntimeState | null> {
  return requestRobotApi<RobotRuntimeState>('/api/robot/status')
}

export async function fetchJobs(): Promise<TreasuryJobRecord[] | null> {
  return requestRobotApi<TreasuryJobRecord[]>('/api/jobs')
}

export async function fetchJobById(jobId: string): Promise<TreasuryJobRecord | null> {
  return requestRobotApi<TreasuryJobRecord>(`/api/jobs/${encodeURIComponent(jobId)}`)
}

export async function tickRobotWorker() {
  return requestRobotApi<RobotRuntimeState>('/api/jobs', {
    method: 'POST',
    body: JSON.stringify({ triggerSource: 'manual' }),
  })
}

export async function approveJob(jobId: string) {
  return requestRobotApi<RobotRuntimeState>(`/api/jobs/${encodeURIComponent(jobId)}/approve`, {
    method: 'POST',
  })
}

export async function rejectJob(jobId: string) {
  return requestRobotApi<RobotRuntimeState>(`/api/jobs/${encodeURIComponent(jobId)}/reject`, {
    method: 'POST',
  })
}

export async function cancelJob(jobId: string) {
  return requestRobotApi<RobotRuntimeState>(`/api/jobs/${encodeURIComponent(jobId)}/cancel`, {
    method: 'POST',
  })
}

export async function fetchExecutionState(): Promise<RobotRuntimeState | null> {
  return fetchRobotStatus()
}

export async function tickExecutionWorker() {
  return tickRobotWorker()
}

export async function approveExecutionRun(runId: string) {
  return approveJob(runId)
}

export async function rejectExecutionRun(runId: string) {
  return rejectJob(runId)
}
