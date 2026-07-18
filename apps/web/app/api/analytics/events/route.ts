import { NextRequest, NextResponse } from 'next/server'
import { productEventNames } from '@/lib/product-analytics'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const allowedEvents = new Set<string>(productEventNames)
const allowedPropertyKeys = new Set(['action', 'elapsedMs', 'exportMethod', 'mode', 'policySource', 'scenario'])

function sanitizeProperties(value: unknown) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return {}
  }

  const sanitized: Record<string, boolean | number | string | null> = {}
  for (const [key, propertyValue] of Object.entries(value)) {
    if (!allowedPropertyKeys.has(key)) {
      continue
    }

    if (propertyValue === null || typeof propertyValue === 'boolean' || typeof propertyValue === 'number' || typeof propertyValue === 'string') {
      sanitized[key] = typeof propertyValue === 'string' ? propertyValue.slice(0, 80) : propertyValue
    }
  }

  return sanitized
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => ({}))) as {
    name?: unknown
    properties?: unknown
    sessionId?: unknown
    timestamp?: unknown
  }

  const name = typeof body.name === 'string' ? body.name : ''
  const sessionId = typeof body.sessionId === 'string' ? body.sessionId : ''
  if (!allowedEvents.has(name) || !/^[A-Za-z0-9_-]{8,128}$/.test(sessionId)) {
    return NextResponse.json({ error: 'Invalid analytics event.' }, { status: 400 })
  }

  console.info(
    JSON.stringify({
      event: 'product_event',
      name,
      properties: sanitizeProperties(body.properties),
      service: 'arc-usdc-rebalancer',
      sessionId,
      timestamp: typeof body.timestamp === 'string' ? body.timestamp : new Date().toISOString(),
    }),
  )

  return new NextResponse(null, {
    headers: {
      'cache-control': 'no-store',
    },
    status: 202,
  })
}
