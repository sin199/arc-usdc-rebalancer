import { initiateDeveloperControlledWalletsClient, type Blockchain as CircleBlockchain } from '@circle-fin/developer-controlled-wallets'
import { isAddress } from 'viem'

const DEFAULT_CIRCLE_API_BASE = 'https://api.circle.com'
const DEFAULT_GATEWAY_API_BASE = 'https://gateway-api-testnet.circle.com'
const DEFAULT_WALLET_BLOCKCHAIN: CircleBlockchain = 'ARC-TESTNET'
const DEFAULT_WALLET_SET_NAME = 'Arc Treasury Control Plane'
const DEFAULT_WALLET_NAME = 'Arc Treasury Operator'
const DEFAULT_GATEWAY_SOURCE_DOMAIN = 26
const DEFAULT_GATEWAY_DESTINATION_DOMAIN = 6

type CircleWalletAccountType = 'EOA' | 'SCA'
type CircleDeveloperWalletsClient = ReturnType<typeof initiateDeveloperControlledWalletsClient>

export type CircleServerConfig = {
  apiBase: string
  apiKey?: string
  entitySecret?: string
  gatewayApiBase: string
  gatewayDestinationDomain: number
  gatewaySourceDomain: number
  walletAccountType: CircleWalletAccountType
  walletBlockchain: CircleBlockchain
  walletName: string
  walletSetId?: string
  walletSetName: string
}

export type CircleReadiness = {
  apiKeyConfigured: boolean
  entitySecretConfigured: boolean
  walletSetConfigured: boolean
  walletBlockchainConfigured: boolean
  gatewayConfigured: boolean
}

function readEnv(name: string) {
  return process.env[name]?.trim() || undefined
}

function parseNumberEnv(value: string | undefined, fallback: number) {
  const parsed = Number(value)

  return Number.isFinite(parsed) ? parsed : fallback
}

function normalizeWalletAccountType(value: string | undefined): CircleWalletAccountType {
  return value === 'SCA' ? 'SCA' : 'EOA'
}

function normalizeWalletBlockchain(value: string | undefined): CircleBlockchain {
  return value === 'ARC-TESTNET' ? 'ARC-TESTNET' : DEFAULT_WALLET_BLOCKCHAIN
}

function createDeveloperWalletsClient(): CircleDeveloperWalletsClient {
  const config = getCircleServerConfig()

  if (!config.apiKey) {
    throw new Error('CIRCLE_API_KEY is missing.')
  }

  if (!config.entitySecret) {
    throw new Error('CIRCLE_ENTITY_SECRET is missing.')
  }

  return initiateDeveloperControlledWalletsClient({
    apiKey: config.apiKey,
    entitySecret: config.entitySecret,
    baseUrl: config.apiBase,
  })
}

export function getCircleServerConfig(): CircleServerConfig {
  return {
    apiBase: readEnv('CIRCLE_API_BASE') ?? DEFAULT_CIRCLE_API_BASE,
    apiKey: readEnv('CIRCLE_API_KEY'),
    entitySecret: readEnv('CIRCLE_ENTITY_SECRET'),
    gatewayApiBase: readEnv('CIRCLE_GATEWAY_API_BASE') ?? DEFAULT_GATEWAY_API_BASE,
    gatewayDestinationDomain: parseNumberEnv(readEnv('CIRCLE_GATEWAY_DESTINATION_DOMAIN'), DEFAULT_GATEWAY_DESTINATION_DOMAIN),
    gatewaySourceDomain: parseNumberEnv(readEnv('CIRCLE_GATEWAY_SOURCE_DOMAIN'), DEFAULT_GATEWAY_SOURCE_DOMAIN),
    walletAccountType: normalizeWalletAccountType(readEnv('CIRCLE_WALLET_ACCOUNT_TYPE')),
    walletBlockchain: normalizeWalletBlockchain(readEnv('CIRCLE_WALLET_BLOCKCHAIN')),
    walletName: readEnv('CIRCLE_WALLET_NAME') ?? DEFAULT_WALLET_NAME,
    walletSetId: readEnv('CIRCLE_WALLET_SET_ID'),
    walletSetName: readEnv('CIRCLE_WALLET_SET_NAME') ?? DEFAULT_WALLET_SET_NAME,
  }
}

export function getCircleReadiness(): CircleReadiness {
  const config = getCircleServerConfig()

  return {
    apiKeyConfigured: Boolean(config.apiKey),
    entitySecretConfigured: Boolean(config.entitySecret),
    gatewayConfigured: Boolean(config.gatewayApiBase),
    walletBlockchainConfigured: Boolean(config.walletBlockchain),
    walletSetConfigured: Boolean(config.walletSetId),
  }
}

export async function fetchCircleGatewayInfo() {
  const config = getCircleServerConfig()
  const response = await fetch(`${config.gatewayApiBase}/v1/info`, {
    method: 'GET',
    headers: {
      accept: 'application/json',
    },
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Gateway info request failed with ${response.status}.`)
  }

  return (await response.json()) as unknown
}

export async function fetchCircleGatewayBalances(depositor: string) {
  const config = getCircleServerConfig()

  if (!isAddress(depositor)) {
    throw new Error('A valid depositor address is required.')
  }

  const response = await fetch(`${config.gatewayApiBase}/v1/balances`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({
      token: 'USDC',
      sources: [
        {
          depositor,
          domain: config.gatewaySourceDomain,
        },
      ],
    }),
    cache: 'no-store',
  })

  if (!response.ok) {
    throw new Error(`Gateway balances request failed with ${response.status}.`)
  }

  return (await response.json()) as unknown
}

export async function fetchCircleWalletSet(walletSetId: string) {
  const client = createDeveloperWalletsClient()
  return client.getWalletSet({ id: walletSetId })
}

export async function fetchCircleWalletsWithBalances(walletSetId: string) {
  const client = createDeveloperWalletsClient()
  return client.getWalletsWithBalances({
    blockchain: getCircleServerConfig().walletBlockchain,
    walletSetId,
  })
}

export async function fetchCircleControlPlaneStatus(params: {
  depositor?: string
  walletSetId?: string
}) {
  const config = getCircleServerConfig()
  const readiness = getCircleReadiness()

  const walletSetId = params.walletSetId || config.walletSetId

  const walletSetPromise =
    readiness.apiKeyConfigured && readiness.entitySecretConfigured && walletSetId
      ? fetchCircleWalletSet(walletSetId).catch(() => null)
      : Promise.resolve(null)

  const walletsPromise =
    readiness.apiKeyConfigured && readiness.entitySecretConfigured && walletSetId
      ? fetchCircleWalletsWithBalances(walletSetId).catch(() => null)
      : Promise.resolve(null)

  const gatewayInfoPromise = fetchCircleGatewayInfo().catch(() => null)
  const gatewayBalancesPromise = params.depositor ? fetchCircleGatewayBalances(params.depositor).catch(() => null) : Promise.resolve(null)

  const [walletSetResponse, walletsResponse, gatewayInfo, gatewayBalances] = await Promise.all([
    walletSetPromise,
    walletsPromise,
    gatewayInfoPromise,
    gatewayBalancesPromise,
  ])

  const walletSet = walletSetResponse?.data?.walletSet ?? null
  const wallets = walletsResponse?.data?.wallets ?? []

  return {
    config: {
      gatewayDestinationDomain: config.gatewayDestinationDomain,
      gatewaySourceDomain: config.gatewaySourceDomain,
      walletAccountType: config.walletAccountType,
      walletBlockchain: config.walletBlockchain,
      walletSetId,
    },
    gatewayBalances,
    gatewayInfo,
    notes: [
      !readiness.apiKeyConfigured ? 'Set CIRCLE_API_KEY for developer wallet reads and creation.' : null,
      !readiness.entitySecretConfigured ? 'Run pnpm circle:bootstrap to generate and register a new entity secret.' : null,
      !walletSetId ? 'Set CIRCLE_WALLET_SET_ID or create a new wallet set from the dashboard.' : null,
    ].filter((note): note is string => Boolean(note)),
    readiness,
    walletSet,
    wallets,
  }
}

export async function createCircleWallet(params?: {
  accountType?: CircleWalletAccountType
  blockchain?: CircleBlockchain
  walletName?: string
  walletSetId?: string
  walletSetName?: string
}) {
  const config = getCircleServerConfig()
  const client = createDeveloperWalletsClient()
  const walletSetId = params?.walletSetId || config.walletSetId
  const walletSetName = params?.walletSetName || config.walletSetName
  const walletName = params?.walletName || config.walletName
  const blockchain = params?.blockchain || config.walletBlockchain
  const accountType = params?.accountType || config.walletAccountType

  let nextWalletSetId = walletSetId
  let walletSet = null

  if (!nextWalletSetId) {
    const walletSetResponse = await client.createWalletSet({
      name: walletSetName,
    })
    walletSet = walletSetResponse.data?.walletSet ?? null
    nextWalletSetId = walletSet?.id

    if (!nextWalletSetId) {
      throw new Error('Circle wallet set creation did not return an ID.')
    }
  } else {
    const walletSetResponse = await client.getWalletSet({ id: nextWalletSetId })
    walletSet = walletSetResponse.data?.walletSet ?? null
  }

  const walletResponse = await client.createWallets({
    accountType,
    blockchains: [blockchain],
    count: 1,
    metadata: [{ name: walletName, refId: walletName }],
    walletSetId: nextWalletSetId,
  })

  const wallets = walletResponse.data?.wallets ?? []

  return {
    accountType,
    blockchain,
    walletSet,
    walletSetId: nextWalletSetId,
    walletName,
    wallets,
  }
}
