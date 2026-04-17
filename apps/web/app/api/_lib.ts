import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

export function json(data: unknown, init?: ResponseInit) {
  return NextResponse.json(data, init)
}

export function errorResponse(error: unknown) {
  const message = error instanceof Error ? error.message : 'Internal server error'
  const status =
    /not found/i.test(message) ? 404 : /validation failed|valid|awaiting approval|can no longer be cancelled/i.test(message) ? 400 : 500

  return NextResponse.json({ error: message }, { status })
}
