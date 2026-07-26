import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
} from 'node:http'
import { timingSafeEqual } from 'node:crypto'
import { isAddress, type Address } from 'viem'
import type { RobotEngine } from './engine'
import type { WorkerConfig } from './config'

type JsonBody = Record<string, unknown>
type CreateJobRequest = {
  type: 'rebalance' | 'wallet-top-up' | 'payout-batch' | 'treasury-sweep'
  amountUsdc: number
  destinationAddress: Address
  executionMode: 'dry-run' | 'manual-approve' | 'auto'
  notes?: string
}

const createJobTypes = new Set<CreateJobRequest['type']>([
  'rebalance',
  'wallet-top-up',
  'payout-batch',
  'treasury-sweep',
])
const createJobExecutionModes = new Set<CreateJobRequest['executionMode']>([
  'dry-run',
  'manual-approve',
  'auto',
])

function setCorsHeaders(
  response: ServerResponse,
  config: WorkerConfig,
  origin: string | undefined,
) {
  if (!origin || !config.allowedOrigins.includes(origin)) {
    return
  }

  response.setHeader('Access-Control-Allow-Origin', origin)
  response.setHeader('Vary', 'Origin')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  response.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type',
  )
}

class RequestBodyTooLargeError extends Error {}

async function readJsonBody(
  request: IncomingMessage,
  maxBytes: number,
): Promise<JsonBody> {
  const chunks: Buffer[] = []
  let totalBytes = 0

  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    totalBytes += buffer.byteLength
    if (totalBytes > maxBytes) {
      throw new RequestBodyTooLargeError(
        'Request body exceeds the configured limit.',
      )
    }
    chunks.push(buffer)
  }

  if (chunks.length === 0) {
    return {}
  }

  const raw = Buffer.concat(chunks).toString('utf8')

  if (!raw.trim()) {
    return {}
  }

  return JSON.parse(raw) as JsonBody
}

function parseCreateJobRequest(body: JsonBody):
  | { ok: true; request: CreateJobRequest }
  | {
      ok: false
      statusCode: number
      payload: { error: string; fieldErrors: Record<string, string> }
    } {
  const fieldErrors: Record<string, string> = {}

  const type = typeof body.jobType === 'string' ? body.jobType.trim() : ''
  if (!createJobTypes.has(type as CreateJobRequest['type'])) {
    fieldErrors.jobType = 'Select one of the supported treasury job types.'
  }

  const executionMode =
    typeof body.executionMode === 'string' ? body.executionMode.trim() : ''
  if (
    !createJobExecutionModes.has(
      executionMode as CreateJobRequest['executionMode'],
    )
  ) {
    fieldErrors.executionMode = 'Select a valid execution mode.'
  }

  const amount =
    typeof body.amountUsdc === 'number'
      ? body.amountUsdc
      : Number(body.amountUsdc)
  if (!Number.isFinite(amount) || amount <= 0) {
    fieldErrors.amountUsdc = 'Enter an amount greater than 0.'
  }

  const destinationAddress =
    typeof body.destinationAddress === 'string'
      ? body.destinationAddress.trim()
      : ''
  if (!isAddress(destinationAddress)) {
    fieldErrors.destinationAddress = 'Enter a valid 0x address.'
  }

  const notes = typeof body.notes === 'string' ? body.notes.trim() : ''

  if (Object.keys(fieldErrors).length > 0) {
    return {
      ok: false,
      statusCode: 400,
      payload: {
        error: 'Validation failed',
        fieldErrors,
      },
    }
  }

  return {
    ok: true,
    request: {
      type: type as CreateJobRequest['type'],
      amountUsdc: amount,
      destinationAddress: destinationAddress as Address,
      executionMode: executionMode as CreateJobRequest['executionMode'],
      ...(notes ? { notes } : {}),
    },
  }
}

function sendJson(
  response: ServerResponse,
  statusCode: number,
  payload: unknown,
) {
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload, null, 2))
}

function hasValidApiToken(request: IncomingMessage, config: WorkerConfig) {
  const expected = config.apiToken
  if (!expected) {
    return false
  }

  const authorization = request.headers.authorization ?? ''
  const prefix = 'Bearer '
  if (!authorization.startsWith(prefix)) {
    return false
  }

  const provided = Buffer.from(authorization.slice(prefix.length))
  const expectedBuffer = Buffer.from(expected)
  return (
    provided.byteLength === expectedBuffer.byteLength &&
    timingSafeEqual(provided, expectedBuffer)
  )
}

export function createRobotServer(engine: RobotEngine, config: WorkerConfig) {
  return createServer(async (request, response) => {
    const origin = request.headers.origin?.trim()
    setCorsHeaders(response, config, origin)

    if (origin && !config.allowedOrigins.includes(origin)) {
      sendJson(response, 403, { error: 'Request origin is not allowed.' })
      return
    }

    if (request.method === 'OPTIONS') {
      if (!origin || config.allowedOrigins.length === 0) {
        sendJson(response, 403, { error: 'CORS origin is not configured.' })
        return
      }
      response.statusCode = 204
      response.end()
      return
    }

    if (request.method === 'POST') {
      if (!config.apiToken) {
        sendJson(response, 503, {
          error: 'Worker API authentication is not configured.',
        })
        return
      }

      if (!hasValidApiToken(request, config)) {
        sendJson(response, 401, {
          error: 'Bearer token authentication is required.',
        })
        return
      }
    }

    const url = new URL(
      request.url ?? '/',
      `http://${request.headers.host ?? 'localhost'}`,
    )
    const route = url.pathname

    try {
      if (request.method === 'GET' && route === '/health') {
        sendJson(response, 200, {
          ok: true,
          mode: config.mode,
          circleExecutorAvailable: config.availability.circleExecutorAvailable,
          bridgeProviderAvailable: config.availability.bridgeProviderAvailable,
        })
        return
      }

      if (request.method === 'GET' && route === '/api/robot/status') {
        sendJson(response, 200, await engine.getState())
        return
      }

      if (request.method === 'GET' && route === '/state') {
        sendJson(response, 200, await engine.getState())
        return
      }

      if (request.method === 'GET' && route === '/api/jobs') {
        const state = await engine.getState()
        sendJson(response, 200, state.jobs)
        return
      }

      if (request.method === 'POST' && route === '/api/jobs/create') {
        const body = await readJsonBody(request, config.maxBodyBytes)
        const parsed = parseCreateJobRequest(body)

        if (!parsed.ok) {
          sendJson(response, parsed.statusCode, parsed.payload)
          return
        }

        const nextState = await engine.createJob(parsed.request)
        sendJson(response, 201, nextState)
        return
      }

      const jobMatch = route.match(/^\/api\/jobs\/([^/]+)$/)
      if (request.method === 'GET' && jobMatch) {
        const job = await engine.getJob(decodeURIComponent(jobMatch[1]))
        if (!job) {
          sendJson(response, 404, { error: 'Job not found' })
          return
        }

        sendJson(response, 200, job)
        return
      }

      if (request.method === 'POST' && route === '/api/jobs') {
        const body = await readJsonBody(request, config.maxBodyBytes)
        const triggerSource =
          body.triggerSource === 'manual' ||
          body.triggerSource === 'approval' ||
          body.triggerSource === 'startup'
            ? body.triggerSource
            : 'schedule'
        const nextState = await engine.refreshSnapshot(triggerSource)
        sendJson(response, 200, nextState)
        return
      }

      if (request.method === 'POST' && route === '/tick') {
        const body = await readJsonBody(request, config.maxBodyBytes)
        const triggerSource =
          body.triggerSource === 'manual' ||
          body.triggerSource === 'approval' ||
          body.triggerSource === 'startup'
            ? body.triggerSource
            : 'schedule'
        const nextState = await engine.refreshSnapshot(triggerSource)
        sendJson(response, 200, nextState)
        return
      }

      const approveMatch = route.match(/^\/api\/jobs\/([^/]+)\/approve$/)
      if (request.method === 'POST' && approveMatch) {
        await readJsonBody(request, config.maxBodyBytes)
        const nextState = await engine.approveJob(
          decodeURIComponent(approveMatch[1]),
        )
        sendJson(response, 200, nextState)
        return
      }

      const rejectMatch = route.match(/^\/api\/jobs\/([^/]+)\/reject$/)
      if (request.method === 'POST' && rejectMatch) {
        await readJsonBody(request, config.maxBodyBytes)
        const nextState = await engine.rejectJob(
          decodeURIComponent(rejectMatch[1]),
        )
        sendJson(response, 200, nextState)
        return
      }

      const cancelMatch = route.match(/^\/api\/jobs\/([^/]+)\/cancel$/)
      if (request.method === 'POST' && cancelMatch) {
        await readJsonBody(request, config.maxBodyBytes)
        const nextState = await engine.cancelJob(
          decodeURIComponent(cancelMatch[1]),
        )
        sendJson(response, 200, nextState)
        return
      }

      const legacyApproveMatch = route.match(/^\/runs\/([^/]+)\/approve$/)
      if (request.method === 'POST' && legacyApproveMatch) {
        await readJsonBody(request, config.maxBodyBytes)
        const nextState = await engine.approveJob(
          decodeURIComponent(legacyApproveMatch[1]),
        )
        sendJson(response, 200, nextState)
        return
      }

      const legacyRejectMatch = route.match(/^\/runs\/([^/]+)\/reject$/)
      if (request.method === 'POST' && legacyRejectMatch) {
        await readJsonBody(request, config.maxBodyBytes)
        const nextState = await engine.rejectJob(
          decodeURIComponent(legacyRejectMatch[1]),
        )
        sendJson(response, 200, nextState)
        return
      }

      const legacyCancelMatch = route.match(/^\/runs\/([^/]+)\/cancel$/)
      if (request.method === 'POST' && legacyCancelMatch) {
        await readJsonBody(request, config.maxBodyBytes)
        const nextState = await engine.cancelJob(
          decodeURIComponent(legacyCancelMatch[1]),
        )
        sendJson(response, 200, nextState)
        return
      }

      sendJson(response, 404, { error: 'Not found' })
    } catch (error) {
      if (error instanceof RequestBodyTooLargeError) {
        sendJson(response, 413, { error: error.message })
        return
      }

      if (error instanceof SyntaxError) {
        sendJson(response, 400, { error: 'Request body must be valid JSON.' })
        return
      }

      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })
}

export const createExecutionServer = createRobotServer
