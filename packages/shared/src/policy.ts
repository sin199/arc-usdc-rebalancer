export type TreasuryPolicy = {
  minThreshold: number
  targetBalance: number
  maxRebalanceAmount: number
}

export type PolicyStatus = 'below_min' | 'healthy' | 'above_target'

export type RebalanceSimulation = {
  status: PolicyStatus
  action: 'hold' | 'top_up' | 'trim'
  amount: number
  reasonCodes: string[]
  message: string
}

export const DEFAULT_TREASURY_POLICY: TreasuryPolicy = {
  minThreshold: 100,
  targetBalance: 500,
  maxRebalanceAmount: 200,
}

export const TREASURY_POLICY_STORAGE_KEY = 'arc-usdc-rebalancer:treasury-policy'
export const ACTIVITY_LOG_STORAGE_KEY = 'arc-usdc-rebalancer:activity-log'

export function formatUsdc(amount: number): string {
  if (!Number.isFinite(amount)) {
    return '0.00'
  }

  return new Intl.NumberFormat('en-US', {
    minimumFractionDigits: amount < 1 ? 4 : 2,
    maximumFractionDigits: amount < 1 ? 4 : 2,
  }).format(amount)
}

export function truncateAddress(address: string, head = 6, tail = 4): string {
  if (!address) {
    return ''
  }

  if (address.length <= head + tail + 2) {
    return address
  }

  return `${address.slice(0, head)}…${address.slice(-tail)}`
}

export function validatePolicy(policy: TreasuryPolicy): string | null {
  if (!Number.isFinite(policy.minThreshold) || policy.minThreshold < 0) {
    return 'Minimum threshold must be 0 or higher.'
  }

  if (!Number.isFinite(policy.targetBalance) || policy.targetBalance < policy.minThreshold) {
    return 'Target balance must be at least the minimum threshold.'
  }

  if (!Number.isFinite(policy.maxRebalanceAmount) || policy.maxRebalanceAmount < 0) {
    return 'Max rebalance amount must be 0 or higher.'
  }

  return null
}

export function evaluatePolicy(balance: number, policy: TreasuryPolicy): RebalanceSimulation {
  if (balance < policy.minThreshold) {
    const amount = Math.min(policy.targetBalance - balance, policy.maxRebalanceAmount)

    return {
      status: 'below_min',
      action: amount > 0 ? 'top_up' : 'hold',
      amount: Math.max(0, amount),
      reasonCodes: ['BELOW_MIN_THRESHOLD', 'MOVE_TOWARD_TARGET'],
      message:
        amount > 0
          ? `Top up ${formatUsdc(Math.max(0, amount))} USDC toward the target balance.`
          : 'Policy is below threshold but max rebalance amount is already exhausted.',
    }
  }

  if (balance > policy.targetBalance) {
    const amount = Math.min(balance - policy.targetBalance, policy.maxRebalanceAmount)

    return {
      status: 'above_target',
      action: amount > 0 ? 'trim' : 'hold',
      amount: Math.max(0, amount),
      reasonCodes: ['ABOVE_TARGET_BALANCE', 'CAP_AT_MAX_REBALANCE'],
      message:
        amount > 0
          ? `Trim ${formatUsdc(Math.max(0, amount))} USDC back to the treasury target.`
          : 'Balance is above target, but the rebalance cap prevents movement.',
    }
  }

  return {
    status: 'healthy',
    action: 'hold',
    amount: 0,
    reasonCodes: ['WITHIN_POLICY_BAND'],
    message: 'Treasury balance is within policy. No rebalance needed.',
  }
}
