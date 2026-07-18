export const productEventNames = ['dashboard_view', 'decision_visible', 'scenario_selected', 'report_exported', 'action_pack_exported', 'execution_requested'] as const

export type ProductEventName = (typeof productEventNames)[number]

type ProductEventProperties = Record<string, boolean | number | string | null>

const sessionStorageKey = 'arc-usdc-rebalancer:anonymous-session'

function getAnonymousSessionId() {
  if (typeof window === 'undefined') {
    return null
  }

  const stored = window.sessionStorage.getItem(sessionStorageKey)
  if (stored) {
    return stored
  }

  const sessionId = crypto.randomUUID()
  window.sessionStorage.setItem(sessionStorageKey, sessionId)
  return sessionId
}

export function trackProductEvent(name: ProductEventName, properties: ProductEventProperties = {}) {
  const sessionId = getAnonymousSessionId()
  if (!sessionId) {
    return
  }

  const body = JSON.stringify({
    name,
    properties,
    sessionId,
    timestamp: new Date().toISOString(),
  })

  if (navigator.sendBeacon) {
    navigator.sendBeacon('/api/analytics/events', new Blob([body], { type: 'application/json' }))
    return
  }

  void fetch('/api/analytics/events', {
    body,
    cache: 'no-store',
    headers: {
      'content-type': 'application/json',
    },
    keepalive: true,
    method: 'POST',
  })
}
