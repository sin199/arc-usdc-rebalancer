import type { ExecutionRuntimeState } from '@arc-usdc-rebalancer/shared'

export const executionApiBaseUrl = process.env.NEXT_PUBLIC_EXECUTION_API_URL?.trim() || ''

async function requestExecutionApi<T>(path: string, init?: RequestInit): Promise<T | null> {
  if (!executionApiBaseUrl) {
    return null
  }

  const response = await fetch(`${executionApiBaseUrl}${path}`, {
    cache: 'no-store',
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  })

  if (!response.ok) {
    const errorText = await response.text()
    throw new Error(errorText || `Execution API request failed: ${response.status}`)
  }

  return (await response.json()) as T
}

export async function fetchExecutionState(): Promise<ExecutionRuntimeState | null> {
  return requestExecutionApi<ExecutionRuntimeState>('/state')
}

export async function tickExecutionWorker() {
  return requestExecutionApi<ExecutionRuntimeState>('/tick', {
    method: 'POST',
    body: JSON.stringify({ triggerSource: 'manual' }),
  })
}

export async function approveExecutionRun(runId: string) {
  return requestExecutionApi<ExecutionRuntimeState>(`/runs/${encodeURIComponent(runId)}/approve`, {
    method: 'POST',
  })
}

export async function rejectExecutionRun(runId: string) {
  return requestExecutionApi<ExecutionRuntimeState>(`/runs/${encodeURIComponent(runId)}/reject`, {
    method: 'POST',
  })
}
