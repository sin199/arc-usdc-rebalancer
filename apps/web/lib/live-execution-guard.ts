import 'server-only'

import { NextRequest, NextResponse } from 'next/server'
import { isAddress, recoverMessageAddress, type Address, type Hex } from 'viem'
import { buildLiveExecutionMessage, type LiveExecutionIntent } from './live-execution-auth'

type GuardState = {
  rateWindows: Map<string, number[]>
  usedRequestIds: Map<string, number>
}

type GuardGlobal = typeof globalThis & {
  __arcLiveExecutionGuard?: GuardState
}

export type LiveExecutionAuthorization = {
  operatorAddress: Address
  requestId: string
}

type AuthorizationResult = { ok: true; authorization: LiveExecutionAuthorization } | { ok: false; response: NextResponse }

const guardGlobal = globalThis as GuardGlobal
const guardState: GuardState =
  guardGlobal.__arcLiveExecutionGuard ??
  (guardGlobal.__arcLiveExecutionGuard = {
    rateWindows: new Map(),
    usedRequestIds: new Map(),
  })

function readPositiveNumber(name: string, fallback: number) {
  const value = Number(process.env[name])
  return Number.isFinite(value) && value > 0 ? value : fallback
}

function readCsv(name: string) {
  return (process.env[name] ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

export function getLiveExecutionStatus() {
  const allowlist = readCsv('LIVE_EXECUTION_OPERATOR_ALLOWLIST').filter((item): item is Address => isAddress(item))
  const enabledByFlag = process.env.ENABLE_LIVE_EXECUTION === 'true'

  return {
    enabled: enabledByFlag && allowlist.length > 0,
    enabledByFlag,
    maxAmountUsdc: readPositiveNumber('LIVE_EXECUTION_MAX_AMOUNT_USDC', 200),
    operatorAllowlistConfigured: allowlist.length > 0,
    authorization: 'wallet_signature' as const,
  }
}

function redactAddress(value: string) {
  return isAddress(value) ? `${value.slice(0, 6)}…${value.slice(-4)}` : 'invalid'
}

function audit(event: string, details: Record<string, unknown>) {
  console.info(
    JSON.stringify({
      event,
      service: 'arc-usdc-rebalancer',
      timestamp: new Date().toISOString(),
      ...details,
    }),
  )
}

export function auditLiveExecution(event: string, details: Record<string, unknown>) {
  audit(event, details)
}

function reject(status: number, error: string, requestId?: string) {
  audit('live_execution_rejected', {
    error,
    requestId: requestId ?? null,
    status,
  })

  return NextResponse.json(
    { error, requestId: requestId ?? null },
    {
      headers: {
        'cache-control': 'no-store',
        ...(requestId ? { 'x-request-id': requestId } : {}),
      },
      status,
    },
  )
}

function cleanupState(now: number, freshnessWindowMs: number) {
  for (const [requestId, usedAt] of guardState.usedRequestIds) {
    if (now - usedAt > freshnessWindowMs * 2) {
      guardState.usedRequestIds.delete(requestId)
    }
  }

  for (const [operator, attempts] of guardState.rateWindows) {
    const recent = attempts.filter((attempt: number) => now - attempt < 60_000)
    if (recent.length === 0) {
      guardState.rateWindows.delete(operator)
    } else {
      guardState.rateWindows.set(operator, recent)
    }
  }
}

function requestOrigin(request: NextRequest) {
  return request.headers.get('origin')?.trim() || ''
}

function isAllowedOrigin(request: NextRequest, origin: string) {
  const configuredOrigins = readCsv('LIVE_EXECUTION_ALLOWED_ORIGINS')
  const allowedOrigins = configuredOrigins.length > 0 ? configuredOrigins : [request.nextUrl.origin]
  return allowedOrigins.includes(origin)
}

export async function authorizeLiveExecution(request: NextRequest, intent: Omit<LiveExecutionIntent, 'origin'>): Promise<AuthorizationResult> {
  const status = getLiveExecutionStatus()
  if (!status.enabledByFlag) {
    return {
      ok: false,
      response: reject(403, 'Live execution is disabled for this deployment.', intent.requestId),
    }
  }

  if (!status.operatorAllowlistConfigured) {
    return {
      ok: false,
      response: reject(403, 'Live execution operator allowlist is not configured.', intent.requestId),
    }
  }

  if (!isAddress(intent.operatorAddress)) {
    return {
      ok: false,
      response: reject(400, 'A valid operator address is required.', intent.requestId),
    }
  }

  if (!/^[A-Za-z0-9_-]{8,128}$/.test(intent.requestId)) {
    return {
      ok: false,
      response: reject(400, 'A valid request ID is required.'),
    }
  }

  const origin = requestOrigin(request)
  if (!origin || !isAllowedOrigin(request, origin)) {
    return {
      ok: false,
      response: reject(403, 'The request origin is not allowed.', intent.requestId),
    }
  }

  const allowlist = new Set(readCsv('LIVE_EXECUTION_OPERATOR_ALLOWLIST').map((item) => item.toLowerCase()))
  if (!allowlist.has(intent.operatorAddress.toLowerCase())) {
    return {
      ok: false,
      response: reject(403, 'The connected operator is not authorized.', intent.requestId),
    }
  }

  const freshnessWindowMs = readPositiveNumber('LIVE_EXECUTION_SIGNATURE_TTL_SECONDS', 60) * 1_000
  const now = Date.now()
  cleanupState(now, freshnessWindowMs)

  if (!Number.isFinite(intent.timestamp) || intent.timestamp > now + 5_000 || now - intent.timestamp > freshnessWindowMs) {
    return {
      ok: false,
      response: reject(401, 'The execution authorization has expired.', intent.requestId),
    }
  }

  if (guardState.usedRequestIds.has(intent.requestId)) {
    return {
      ok: false,
      response: reject(409, 'This execution request has already been used.', intent.requestId),
    }
  }

  const signature = request.headers.get('x-operator-signature')?.trim()
  if (!signature || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    return {
      ok: false,
      response: reject(401, 'A wallet signature is required.', intent.requestId),
    }
  }

  const message = buildLiveExecutionMessage({ ...intent, origin })
  let recoveredAddress: Address
  try {
    recoveredAddress = await recoverMessageAddress({
      message,
      signature: signature as Hex,
    })
  } catch {
    return {
      ok: false,
      response: reject(401, 'The wallet signature is invalid.', intent.requestId),
    }
  }

  if (recoveredAddress.toLowerCase() !== intent.operatorAddress.toLowerCase()) {
    return {
      ok: false,
      response: reject(401, 'The wallet signature does not match the operator.', intent.requestId),
    }
  }

  const rateLimit = Math.max(1, Math.floor(readPositiveNumber('LIVE_EXECUTION_RATE_LIMIT_PER_MINUTE', 3)))
  const operatorKey = recoveredAddress.toLowerCase()
  const attempts = guardState.rateWindows.get(operatorKey) ?? []
  if (attempts.length >= rateLimit) {
    return {
      ok: false,
      response: reject(429, 'The live execution rate limit has been reached.', intent.requestId),
    }
  }

  if (intent.kind === 'execute') {
    if (!Number.isFinite(intent.amountUsdc) || (intent.amountUsdc ?? 0) <= 0) {
      return {
        ok: false,
        response: reject(400, 'Execution amount must be positive.', intent.requestId),
      }
    }

    if ((intent.amountUsdc ?? 0) > status.maxAmountUsdc) {
      return {
        ok: false,
        response: reject(400, `Execution amount exceeds the ${status.maxAmountUsdc} USDC deployment limit.`, intent.requestId),
      }
    }
  }

  guardState.rateWindows.set(operatorKey, [...attempts, now])
  guardState.usedRequestIds.set(intent.requestId, now)
  audit('live_execution_authorized', {
    kind: intent.kind,
    operator: redactAddress(recoveredAddress),
    requestId: intent.requestId,
  })

  return {
    ok: true,
    authorization: {
      operatorAddress: recoveredAddress,
      requestId: intent.requestId,
    },
  }
}
