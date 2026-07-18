export type RetryOptions = {
  attempts?: number
  delaysMs?: number[]
  sleep?: (delayMs: number) => Promise<void>
}

export type Snapshot<T> = {
  value: T
  observedAt: string
}

export type SnapshotFallbackOptions<T> = {
  cached?: Snapshot<T>
  label: string
  now?: () => Date
  operation: () => Promise<T>
  retry?: RetryOptions
  updateCache: (snapshot: Snapshot<T>) => void
}

const defaultSleep = (delayMs: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, delayMs))

export async function withBoundedRetry<T>(
  operation: () => Promise<T>,
  options: RetryOptions = {},
): Promise<T> {
  const attempts = Math.max(1, options.attempts ?? 3)
  const delaysMs = options.delaysMs ?? [120, 300]
  const sleep = options.sleep ?? defaultSleep
  let lastError: unknown

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      return await operation()
    } catch (error) {
      lastError = error

      if (attempt < attempts - 1) {
        await sleep(delaysMs[Math.min(attempt, delaysMs.length - 1)] ?? 0)
      }
    }
  }

  throw lastError
}

export function conciseRpcError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error)
  const rateLimited =
    /rate limit|request limit|too many requests|\b429\b/i.test(message)

  return rateLimited
    ? 'Arc Testnet RPC rate limit reached.'
    : message
        .split('\n')
        .find((line) => line.trim())
        ?.trim() || 'Arc Testnet RPC request failed.'
}

export async function readWithSnapshotFallback<T>(
  options: SnapshotFallbackOptions<T>,
) {
  try {
    const value = await withBoundedRetry(options.operation, options.retry)
    const observedAt = (options.now?.() ?? new Date()).toISOString()
    options.updateCache({ value, observedAt })

    return {
      value,
      status: 'live' as const,
      observedAt,
      warning: undefined,
    }
  } catch (error) {
    const reason = conciseRpcError(error)

    if (options.cached) {
      return {
        value: options.cached.value,
        status: 'cached' as const,
        observedAt: options.cached.observedAt,
        warning: `${options.label} live read failed (${reason}) Using a cached snapshot from ${options.cached.observedAt}.`,
      }
    }

    return {
      value: null,
      status: 'unavailable' as const,
      observedAt: undefined,
      warning: `${options.label} is unavailable. ${reason}`,
    }
  }
}
