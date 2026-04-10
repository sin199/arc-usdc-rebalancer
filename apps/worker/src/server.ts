import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import type { RobotEngine } from './engine'
import type { WorkerConfig } from './config'

type JsonBody = Record<string, unknown>

function setCorsHeaders(response: ServerResponse) {
  response.setHeader('Access-Control-Allow-Origin', '*')
  response.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS')
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type')
}

async function readJsonBody(request: IncomingMessage): Promise<JsonBody> {
  const chunks: Buffer[] = []

  for await (const chunk of request) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
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

function sendJson(response: ServerResponse, statusCode: number, payload: unknown) {
  setCorsHeaders(response)
  response.statusCode = statusCode
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.end(JSON.stringify(payload, null, 2))
}

export function createRobotServer(engine: RobotEngine, config: WorkerConfig) {
  return createServer(async (request, response) => {
    setCorsHeaders(response)

    if (request.method === 'OPTIONS') {
      response.statusCode = 204
      response.end()
      return
    }

    const url = new URL(request.url ?? '/', `http://${request.headers.host ?? 'localhost'}`)
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
        const body = await readJsonBody(request)
        const triggerSource =
          body.triggerSource === 'manual' || body.triggerSource === 'approval' || body.triggerSource === 'startup'
            ? body.triggerSource
            : 'schedule'
        const nextState = await engine.refreshSnapshot(triggerSource)
        sendJson(response, 200, nextState)
        return
      }

      if (request.method === 'POST' && route === '/tick') {
        const body = await readJsonBody(request)
        const triggerSource =
          body.triggerSource === 'manual' || body.triggerSource === 'approval' || body.triggerSource === 'startup'
            ? body.triggerSource
            : 'schedule'
        const nextState = await engine.refreshSnapshot(triggerSource)
        sendJson(response, 200, nextState)
        return
      }

      const approveMatch = route.match(/^\/api\/jobs\/([^/]+)\/approve$/)
      if (request.method === 'POST' && approveMatch) {
        const nextState = await engine.approveJob(decodeURIComponent(approveMatch[1]))
        sendJson(response, 200, nextState)
        return
      }

      const rejectMatch = route.match(/^\/api\/jobs\/([^/]+)\/reject$/)
      if (request.method === 'POST' && rejectMatch) {
        const nextState = await engine.rejectJob(decodeURIComponent(rejectMatch[1]))
        sendJson(response, 200, nextState)
        return
      }

      const cancelMatch = route.match(/^\/api\/jobs\/([^/]+)\/cancel$/)
      if (request.method === 'POST' && cancelMatch) {
        const nextState = await engine.cancelJob(decodeURIComponent(cancelMatch[1]))
        sendJson(response, 200, nextState)
        return
      }

      const legacyApproveMatch = route.match(/^\/runs\/([^/]+)\/approve$/)
      if (request.method === 'POST' && legacyApproveMatch) {
        const nextState = await engine.approveJob(decodeURIComponent(legacyApproveMatch[1]))
        sendJson(response, 200, nextState)
        return
      }

      const legacyRejectMatch = route.match(/^\/runs\/([^/]+)\/reject$/)
      if (request.method === 'POST' && legacyRejectMatch) {
        const nextState = await engine.rejectJob(decodeURIComponent(legacyRejectMatch[1]))
        sendJson(response, 200, nextState)
        return
      }

      const legacyCancelMatch = route.match(/^\/runs\/([^/]+)\/cancel$/)
      if (request.method === 'POST' && legacyCancelMatch) {
        const nextState = await engine.cancelJob(decodeURIComponent(legacyCancelMatch[1]))
        sendJson(response, 200, nextState)
        return
      }

      sendJson(response, 404, { error: 'Not found' })
    } catch (error) {
      sendJson(response, 500, {
        error: error instanceof Error ? error.message : 'Unknown error',
      })
    }
  })
}

export const createExecutionServer = createRobotServer
