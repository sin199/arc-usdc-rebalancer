import { arcTestnetChainId } from './arc'

const circleWalletModeOptions = ['developer-controlled', 'user-controlled', 'modular'] as const
const circleTransferModeOptions = ['gateway', 'bridge-stablecoin'] as const

export type CircleWalletMode = (typeof circleWalletModeOptions)[number]
export type CircleTransferMode = (typeof circleTransferModeOptions)[number]

function readEnv(value: string | undefined, fallback: string) {
  const trimmed = value?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : fallback
}

function normalizeMode<T extends readonly string[]>(value: string, allowed: T, fallback: T[number]) {
  return (allowed as readonly string[]).includes(value) ? (value as T[number]) : fallback
}

export const circleSkillsPageUrl = 'https://developers.circle.com/ai/skills'
export const circleWalletSetLocalStorageKey = 'arc-usdc-rebalancer:circle-wallet-set-id'

export const circleSkillCatalog = [
  {
    name: 'use-arc',
    description: 'Arc Testnet chain config and USDC rails.',
  },
  {
    name: 'use-developer-controlled-wallets',
    description: 'Treasury operator wallet and signing flow.',
  },
  {
    name: 'use-gateway',
    description: 'Stablecoin routing and transfer orchestration.',
  },
  {
    name: 'bridge-stablecoin',
    description: 'Cross-chain USDC transport.',
  },
  {
    name: 'use-smart-contract-platform',
    description: 'Policy and executor contract lifecycle.',
  },
] as const

export const circleStackConfig = {
  walletMode: normalizeMode(
    readEnv(process.env.NEXT_PUBLIC_CIRCLE_WALLET_MODE, 'developer-controlled'),
    circleWalletModeOptions,
    'developer-controlled',
  ),
  transferMode: normalizeMode(
    readEnv(process.env.NEXT_PUBLIC_CIRCLE_TRANSFER_MODE, 'gateway'),
    circleTransferModeOptions,
    'gateway',
  ),
  sourceChain: readEnv(process.env.NEXT_PUBLIC_CIRCLE_SOURCE_CHAIN, 'Arc Testnet'),
  destinationChain: readEnv(process.env.NEXT_PUBLIC_CIRCLE_DESTINATION_CHAIN, 'Base'),
  arcChainId: arcTestnetChainId,
  skillsPageUrl: circleSkillsPageUrl,
} as const

export function circleWalletModeLabel(mode: CircleWalletMode) {
  switch (mode) {
    case 'developer-controlled':
      return 'Developer-controlled wallets'
    case 'user-controlled':
      return 'User-controlled wallets'
    case 'modular':
      return 'Modular wallets'
    default:
      return mode
  }
}

export function circleTransferModeLabel(mode: CircleTransferMode) {
  switch (mode) {
    case 'gateway':
      return 'Gateway'
    case 'bridge-stablecoin':
      return 'Bridge stablecoin'
    default:
      return mode
  }
}

export function circleStackSummary() {
  return `${circleWalletModeLabel(circleStackConfig.walletMode)} · ${circleTransferModeLabel(circleStackConfig.transferMode)} · ${circleStackConfig.sourceChain} → ${circleStackConfig.destinationChain}`
}
