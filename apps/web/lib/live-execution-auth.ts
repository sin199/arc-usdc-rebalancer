export type LiveExecutionAction = 'top_up' | 'trim'

export type LiveExecutionIntent = {
  kind: 'execute' | 'deploy_executor'
  operatorAddress: string
  origin: string
  requestId: string
  timestamp: number
  action?: LiveExecutionAction
  amountUsdc?: number
  executorAddress?: string
}

export function buildLiveExecutionMessage(intent: LiveExecutionIntent) {
  return [
    'Arc USDC Rebalancer live execution authorization',
    'Version: 1',
    `Origin: ${intent.origin}`,
    `Request ID: ${intent.requestId}`,
    `Timestamp: ${intent.timestamp}`,
    `Operator: ${intent.operatorAddress.toLowerCase()}`,
    `Kind: ${intent.kind}`,
    `Action: ${intent.action ?? 'none'}`,
    `Amount USDC: ${intent.amountUsdc ?? 0}`,
    `Executor: ${intent.executorAddress?.toLowerCase() ?? 'configured'}`,
    '',
    'Signing authorizes one Arc Testnet request. It does not expose your private key.',
  ].join('\n')
}
