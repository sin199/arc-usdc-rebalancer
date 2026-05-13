import { formatUnits, isAddress, parseUnits, type Address } from 'viem'
import {
  arcTestnetRpcUrl as defaultArcTestnetRpcUrl,
  arcTreasuryPolicyDecimals,
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
    parseUnits(String(policy.minThreshold), arcTreasuryPolicyDecimals),
    parseUnits(String(policy.targetBalance), arcTreasuryPolicyDecimals),
    parseUnits(String(policy.maxRebalanceAmount), arcTreasuryPolicyDecimals),
  ]
}

export function formatTreasuryPolicyFromUnits(policy: readonly [bigint, bigint, bigint]): TreasuryPolicy {
  return {
    minThreshold: Number(formatUnits(policy[0], arcTreasuryPolicyDecimals)),
    targetBalance: Number(formatUnits(policy[1], arcTreasuryPolicyDecimals)),
    maxRebalanceAmount: Number(formatUnits(policy[2], arcTreasuryPolicyDecimals)),
  }
}

export function formatTreasuryPolicyAmount(value: bigint): number {
  return Number(formatUnits(value, arcTreasuryPolicyDecimals))
}
