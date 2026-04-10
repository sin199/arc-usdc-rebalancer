import { existsSync } from 'node:fs'
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { isAddress, type Address } from 'viem'
import {
  arcTestnetRpcUrl as defaultArcTestnetRpcUrl,
  type RobotAvailability,
  type RobotExecutionMode,
  type RobotSafetyConfig,
  type TreasuryJobRecipient,
} from '@arc-usdc-rebalancer/shared'

export type WorkerConfig = {
  mode: RobotExecutionMode
  rpcUrl: string
  policyAddress: Address
  treasuryAddress: Address
  statePath: string
  pollIntervalMs: number
  balanceOverrideUsdc?: number
  safety: RobotSafetyConfig
  payoutRecipients: TreasuryJobRecipient[]
  availability: RobotAvailability
}

function parseBoolean(value: string | undefined, fallback: boolean) {
  if (value === undefined || value.trim() === '') {
    return fallback
  }

  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase())
}

function parseNumber(value: string | undefined, fallback: number) {
  if (value === undefined || value.trim() === '') {
    return fallback
  }

  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : fallback
}

function parseAddress(value: string | undefined): Address | undefined {
  if (!value) {
    return undefined
  }

  const trimmed = value.trim()

  return isAddress(trimmed) ? trimmed : undefined
}

function parseAddressList(value: string | undefined): Address[] {
  if (!value) {
    return []
  }

  return value
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0 && isAddress(entry)) as Address[]
}

function parseRecipients(value: string | undefined): TreasuryJobRecipient[] {
  if (!value || value.trim() === '') {
    return []
  }

  try {
    const parsed = JSON.parse(value) as Array<{
      address?: string
      amountUsdc?: unknown
      label?: string
    }>

    return parsed
      .map((entry) => {
        const address = parseAddress(entry.address)
        const amount = typeof entry.amountUsdc === 'number' ? entry.amountUsdc : Number(entry.amountUsdc)

        if (!address || !Number.isFinite(amount) || amount <= 0) {
          return null
        }

        const recipient: TreasuryJobRecipient = {
          address,
          amountUsdc: amount,
        }

        const label = entry.label?.trim()
        if (label) {
          recipient.label = label
        }

        return recipient
      })
      .filter((entry): entry is TreasuryJobRecipient => entry !== null)
  } catch {
    return []
  }
}

export function resolveWorkerConfig(env = process.env): WorkerConfig {
  const missingEnvVars: string[] = []

  const rpcUrl = env.ARC_TESTNET_RPC_URL?.trim() || defaultArcTestnetRpcUrl
  const policyAddress = parseAddress(env.TREASURY_POLICY_ADDRESS)
  const treasuryAddress = parseAddress(env.TREASURY_EXECUTION_ADDRESS)

  if (!env.ARC_TESTNET_RPC_URL?.trim()) {
    missingEnvVars.push('ARC_TESTNET_RPC_URL')
  }

  if (!policyAddress) {
    missingEnvVars.push('TREASURY_POLICY_ADDRESS')
  }

  if (!treasuryAddress) {
    missingEnvVars.push('TREASURY_EXECUTION_ADDRESS')
  }

  const circleApiKey = env.CIRCLE_API_KEY?.trim()
  const circleEntitySecret = env.CIRCLE_ENTITY_SECRET?.trim()
  const circleWalletAddress = env.CIRCLE_WALLET_ADDRESS?.trim()
  const circleWalletBlockchain = env.CIRCLE_WALLET_BLOCKCHAIN?.trim()

  const circleExecutorAvailable = Boolean(
    circleApiKey && circleEntitySecret && circleWalletAddress && circleWalletBlockchain,
  )

  const mode = (env.EXECUTION_MODE?.trim() || 'dry-run') as RobotExecutionMode
  const statePath = env.EXECUTION_STATE_PATH?.trim() || './data/execution-state.json'
  const pollIntervalMs = parseNumber(env.EXECUTION_POLL_INTERVAL_MS, 60_000)
  const balanceOverrideValue = env.EXECUTION_BALANCE_OVERRIDE_USDC?.trim()
  const balanceOverrideUsdc = balanceOverrideValue ? Number(balanceOverrideValue) : undefined
  const bridgeRequested = parseBoolean(env.EXECUTION_BRIDGE_TOP_UP_ENABLED, false)

  if (mode === 'auto' && !circleExecutorAvailable) {
    missingEnvVars.push(
      'CIRCLE_API_KEY',
      'CIRCLE_ENTITY_SECRET',
      'CIRCLE_WALLET_ADDRESS',
      'CIRCLE_WALLET_BLOCKCHAIN',
    )
  }

  const bridgeProviderAvailable = Boolean(
    bridgeRequested &&
      env.BRIDGE_SOURCE_CHAIN?.trim() &&
      env.BRIDGE_SOURCE_WALLET_ADDRESS?.trim() &&
      env.BRIDGE_DESTINATION_CHAIN?.trim() &&
      env.BRIDGE_DESTINATION_WALLET_ADDRESS?.trim(),
  )

  if (bridgeRequested && !bridgeProviderAvailable) {
    missingEnvVars.push(
      'BRIDGE_SOURCE_CHAIN',
      'BRIDGE_SOURCE_WALLET_ADDRESS',
      'BRIDGE_DESTINATION_CHAIN',
      'BRIDGE_DESTINATION_WALLET_ADDRESS',
    )
  }

  const safety: RobotSafetyConfig = {
    globalPaused: parseBoolean(env.EXECUTION_GLOBAL_PAUSE, false),
    policyPaused: parseBoolean(env.EXECUTION_POLICY_PAUSED, false),
    emergencyStop: parseBoolean(env.EXECUTION_EMERGENCY_STOP, false),
    maxExecutionAmountUsdc: parseNumber(env.EXECUTION_MAX_EXECUTION_AMOUNT_USDC, 1_000),
    dailyNotionalCapUsdc: parseNumber(env.EXECUTION_DAILY_NOTIONAL_CAP_USDC, 5_000),
    cooldownMinutes: parseNumber(env.EXECUTION_COOLDOWN_MINUTES, 30),
    destinationAllowlist: parseAddressList(env.EXECUTION_DESTINATION_ALLOWLIST),
    rebalanceDestinationAddress: parseAddress(env.EXECUTION_REBALANCE_DESTINATION_ADDRESS),
    bridgeTopUpEnabled: bridgeRequested,
  }

  const payoutRecipients = parseRecipients(env.EXECUTION_PAYOUT_BATCHES_JSON)

  return {
    mode,
    rpcUrl,
    policyAddress: policyAddress ?? ('0x0000000000000000000000000000000000000000' as Address),
    treasuryAddress: treasuryAddress ?? ('0x0000000000000000000000000000000000000000' as Address),
    statePath: path.resolve(statePath),
    pollIntervalMs,
    balanceOverrideUsdc: Number.isFinite(balanceOverrideUsdc) ? balanceOverrideUsdc : undefined,
    safety,
    payoutRecipients,
    availability: {
      circleExecutorAvailable,
      bridgeProviderAvailable,
      autoEnabled: circleExecutorAvailable && mode === 'auto',
      missingEnvVars: [...new Set(missingEnvVars)],
    },
  }
}

export async function ensureStateDirectory(statePath: string) {
  const directory = path.dirname(statePath)

  if (!existsSync(directory)) {
    await mkdir(directory, { recursive: true })
  }
}
