import { formatUnits, isAddress, parseUnits, type Address } from 'viem'
import {
  arcTestnetRpcUrl as defaultArcTestnetRpcUrl,
  arcUsdcDecimals,
  type TreasuryPolicy,
} from '@arc-usdc-rebalancer/shared'

const configuredRpcUrl = process.env.ARC_TESTNET_RPC_URL?.trim()
const configuredContractAddress = process.env.TREASURY_POLICY_ADDRESS?.trim()

export const arcTestnetRpcUrl = configuredRpcUrl || defaultArcTestnetRpcUrl

export type TreasuryPolicyAddressStatus = 'configured' | 'missing' | 'invalid'

export const treasuryPolicyAddressConfig: {
  address?: Address
  raw?: string
  status: TreasuryPolicyAddressStatus
} = (() => {
  if (!configuredContractAddress) {
    return { status: 'missing' }
  }

  if (!isAddress(configuredContractAddress)) {
    return { status: 'invalid', raw: configuredContractAddress }
  }

  return { status: 'configured', address: configuredContractAddress }
})()

export function parseTreasuryPolicyToUnits(policy: TreasuryPolicy): readonly [bigint, bigint, bigint] {
  return [
    parseUnits(String(policy.minThreshold), arcUsdcDecimals),
    parseUnits(String(policy.targetBalance), arcUsdcDecimals),
    parseUnits(String(policy.maxRebalanceAmount), arcUsdcDecimals),
  ]
}

export function formatTreasuryPolicyFromUnits(policy: readonly [bigint, bigint, bigint]): TreasuryPolicy {
  return {
    minThreshold: Number(formatUnits(policy[0], arcUsdcDecimals)),
    targetBalance: Number(formatUnits(policy[1], arcUsdcDecimals)),
    maxRebalanceAmount: Number(formatUnits(policy[2], arcUsdcDecimals)),
  }
}

export function formatTreasuryPolicyAmount(value: bigint): number {
  return Number(formatUnits(value, arcUsdcDecimals))
}

