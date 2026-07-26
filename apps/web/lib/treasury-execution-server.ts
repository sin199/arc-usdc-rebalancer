import type { Address } from 'viem'

export type TreasuryExecutionAction = 'top_up' | 'trim'

export type TreasuryExecutionResult = {
  action: TreasuryExecutionAction
  amountUsdc: number
  executorAddress?: Address
  ownerAddress?: Address
  recipient?: Address
  txHashes: Record<string, never>
  summary: string
  mode: 'disabled'
}

export type TreasuryExecutorDeploymentResult = {
  executorAddress?: Address
  ownerAddress?: Address
  txHash?: `0x${string}`
  summary: string
  mode: 'disabled'
}

const readOnlyError =
  'Treasury writes are disabled in the submitted public deployment.'

export async function runTreasuryExecution(params: {
  action: TreasuryExecutionAction
  amountUsdc: number
  recipient?: Address
  executorAddress?: Address
}): Promise<TreasuryExecutionResult> {
  void params
  throw new Error(readOnlyError)
}

export async function deployTreasuryExecutorServerSide(): Promise<TreasuryExecutorDeploymentResult> {
  throw new Error(
    'Treasury executor deployment is disabled in the submitted public deployment.',
  )
}
