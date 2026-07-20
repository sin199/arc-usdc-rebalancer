import {
  encodeAbiParameters,
  isAddress,
  keccak256,
  parseAbiParameters,
  parseUnits,
  stringToHex,
  type Address,
  type Hex,
} from 'viem'
import type { TreasuryPolicy } from './policy'

export type TreasuryDecisionAction = 'hold' | 'top_up' | 'trim' | 'review'
export type TreasuryDecisionPolicySource = 'draft' | 'live'

export type TreasuryDecisionReceiptInput = {
  action: TreasuryDecisionAction
  amountUsdc: number
  balanceUsdc: number
  chainId: number
  executorAddress?: string
  observedAt: string
  policy: TreasuryPolicy
  policyAddress?: string
  policySource: TreasuryDecisionPolicySource
}

export type TreasuryDecisionReceipt = {
  action: TreasuryDecisionAction
  actionCode: number
  amountUsdc: string
  balanceUsdc: string
  chainId: number
  executorAddress: Address
  observedAt: string
  observedAtUnix: string
  policy: {
    maxRebalanceAmountUsdc: string
    minThresholdUsdc: string
    targetBalanceUsdc: string
  }
  policyAddress: Address
  policySource: TreasuryDecisionPolicySource
  receiptHash: Hex
}

const receiptDomain = keccak256(
  stringToHex('ARC_USDC_REBALANCER_TREASURY_DECISION_RECEIPT_V1'),
)
const zeroAddress = '0x0000000000000000000000000000000000000000' as const

const actionCodes: Record<TreasuryDecisionAction, number> = {
  hold: 0,
  top_up: 1,
  trim: 2,
  review: 3,
}

const policySourceCodes: Record<TreasuryDecisionPolicySource, number> = {
  draft: 0,
  live: 1,
}

function toUsdcUnits(value: number, label: string) {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be a non-negative finite USDC amount.`)
  }

  return parseUnits(value.toFixed(6), 6)
}

function toAddress(value?: string): Address {
  return value && isAddress(value) ? (value as Address) : zeroAddress
}

export function buildTreasuryDecisionReceipt(
  input: TreasuryDecisionReceiptInput,
): TreasuryDecisionReceipt {
  if (!Number.isSafeInteger(input.chainId) || input.chainId <= 0) {
    throw new Error('chainId must be a positive safe integer.')
  }

  const observedAtMs = Date.parse(input.observedAt)
  if (!Number.isFinite(observedAtMs) || observedAtMs < 0) {
    throw new Error('observedAt must be a valid ISO timestamp.')
  }

  const policyAddress = toAddress(input.policyAddress)
  const executorAddress = toAddress(input.executorAddress)
  const balanceUsdc = toUsdcUnits(input.balanceUsdc, 'balanceUsdc')
  const minThresholdUsdc = toUsdcUnits(
    input.policy.minThreshold,
    'policy.minThreshold',
  )
  const targetBalanceUsdc = toUsdcUnits(
    input.policy.targetBalance,
    'policy.targetBalance',
  )
  const maxRebalanceAmountUsdc = toUsdcUnits(
    input.policy.maxRebalanceAmount,
    'policy.maxRebalanceAmount',
  )
  const amountUsdc = toUsdcUnits(input.amountUsdc, 'amountUsdc')
  const actionCode = actionCodes[input.action]
  const policySourceCode = policySourceCodes[input.policySource]
  const observedAtUnix = BigInt(Math.floor(observedAtMs / 1_000))

  const receiptHash = keccak256(
    encodeAbiParameters(
      parseAbiParameters(
        'bytes32 domain,uint256 chainId,address policyAddress,address executorAddress,uint8 policySource,uint8 action,uint256 balanceUsdc,uint256 minThresholdUsdc,uint256 targetBalanceUsdc,uint256 maxRebalanceAmountUsdc,uint256 amountUsdc,uint256 observedAtUnix',
      ),
      [
        receiptDomain,
        BigInt(input.chainId),
        policyAddress,
        executorAddress,
        policySourceCode,
        actionCode,
        balanceUsdc,
        minThresholdUsdc,
        targetBalanceUsdc,
        maxRebalanceAmountUsdc,
        amountUsdc,
        observedAtUnix,
      ],
    ),
  )

  return {
    action: input.action,
    actionCode,
    amountUsdc: amountUsdc.toString(),
    balanceUsdc: balanceUsdc.toString(),
    chainId: input.chainId,
    executorAddress,
    observedAt: new Date(observedAtMs).toISOString(),
    observedAtUnix: observedAtUnix.toString(),
    policy: {
      maxRebalanceAmountUsdc: maxRebalanceAmountUsdc.toString(),
      minThresholdUsdc: minThresholdUsdc.toString(),
      targetBalanceUsdc: targetBalanceUsdc.toString(),
    },
    policyAddress,
    policySource: input.policySource,
    receiptHash,
  }
}
