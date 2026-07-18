import { keccak256, toHex, type Hex } from 'viem'

export type LiveExecutionAction = 'top_up' | 'trim'
export type LiveExecutionIntentKind =
  | 'execute'
  | 'deploy_executor'
  | 'activate_agent'
  | 'create_circle_wallet'

type CanonicalJson =
  | boolean
  | null
  | number
  | string
  | CanonicalJson[]
  | { [key: string]: CanonicalJson }

export type LiveExecutionIntent = {
  kind: LiveExecutionIntentKind
  operatorAddress: string
  origin: string
  requestId: string
  timestamp: number
  action?: LiveExecutionAction
  amountUsdc?: number
  executorAddress?: string
  payloadHash?: Hex
}

function canonicalize(value: CanonicalJson): string {
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }

  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalize(item)).join(',')}]`
  }

  return `{${Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
    .join(',')}}`
}

export function hashLiveExecutionPayload(
  payload: Record<string, CanonicalJson>,
): Hex {
  return keccak256(toHex(canonicalize(payload)))
}

export function buildLiveExecutionMessage(intent: LiveExecutionIntent) {
  return [
    'Arc USDC Rebalancer live execution authorization',
    'Version: 2',
    `Origin: ${intent.origin}`,
    `Request ID: ${intent.requestId}`,
    `Timestamp: ${intent.timestamp}`,
    `Operator: ${intent.operatorAddress.toLowerCase()}`,
    `Kind: ${intent.kind}`,
    `Action: ${intent.action ?? 'none'}`,
    `Amount USDC: ${intent.amountUsdc ?? 0}`,
    `Executor: ${intent.executorAddress?.toLowerCase() ?? 'configured'}`,
    `Payload hash: ${intent.payloadHash ?? 'none'}`,
    '',
    'Signing authorizes one Arc Testnet request. It does not expose your private key.',
  ].join('\n')
}
