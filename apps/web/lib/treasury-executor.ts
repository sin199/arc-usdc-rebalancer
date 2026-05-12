import { isAddress, type Address } from 'viem'

const configuredExecutorAddress = process.env.TREASURY_EXECUTOR_ADDRESS?.trim()
export const treasuryExecutorLocalStorageKey = 'arc-usdc-rebalancer:treasury-executor-address'

export type TreasuryExecutorAddressStatus = 'configured' | 'missing' | 'invalid'

export const treasuryExecutorAddressConfig: {
  address?: Address
  raw?: string
  status: TreasuryExecutorAddressStatus
} = (() => {
  if (!configuredExecutorAddress) {
    return { status: 'missing' }
  }

  if (!isAddress(configuredExecutorAddress)) {
    return { status: 'invalid', raw: configuredExecutorAddress }
  }

  return { status: 'configured', address: configuredExecutorAddress }
})()
