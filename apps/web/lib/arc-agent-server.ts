import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getContract,
  http,
  keccak256,
  formatUnits,
  parseAbi,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  arcUsdcDecimals,
  arcTreasuryPolicyDecimals,
  evaluatePolicy,
  formatUsdc,
  arcTestnetChainId,
  arcTestnetExplorerUrl,
  arcTestnetRpcUrl,
  treasuryPolicyContractAbi,
} from '@arc-usdc-rebalancer/shared'
import {
  arcAgentId,
  arcAgentIdentityRegistryAddress,
  arcAgentMetadataUri,
  arcAgentOwnerAddress,
  arcAgentReputationRegistryAddress,
  arcAgentValidationRegistryAddress,
  arcAgentValidationRequestHash,
  arcAgentValidationTag,
  arcAgentValidatorAddress,
} from './arc-agent'
import { fetchCircleControlPlaneStatus, type CircleReadiness } from './circle-server'
import { treasuryExecutorAddressConfig } from './treasury-executor'
import { treasuryPolicyAddressConfig } from './treasury-policy'

const arcTestnet = defineChain({
  id: arcTestnetChainId,
  name: 'Arc Testnet',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: arcUsdcDecimals,
  },
  rpcUrls: {
    default: { http: [arcTestnetRpcUrl] },
    public: { http: [arcTestnetRpcUrl] },
  },
  blockExplorers: {
    default: {
      name: 'Arc Scan',
      url: arcTestnetExplorerUrl,
    },
  },
})

const identityAbi = parseAbi([
  'function ownerOf(uint256 tokenId) external view returns (address)',
  'function tokenURI(uint256 tokenId) external view returns (string)',
])

const reputationAbi = parseAbi([
  'function giveFeedback(uint256 agentId, int128 score, uint8 outcome, string tag, string metadataURI, string note, string extra, bytes32 feedbackHash) external',
])

const validationAbi = parseAbi([
  'function validationRequest(address validator, uint256 agentId, string requestURI, bytes32 requestHash) external',
  'function validationResponse(bytes32 requestHash, uint8 response, string responseURI, bytes32 responseHash, string tag) external',
  'function getValidationStatus(bytes32 requestHash) external view returns (address validatorAddress, uint256 agentId, uint8 response, bytes32 responseHash, string tag, uint256 lastUpdate)',
])

type ValidationStatus = readonly [
  `0x${string}`,
  bigint,
  number,
  `0x${string}`,
  string,
  bigint,
]

type ArcAgentActivationResult = {
  agentId: string
  owner: `0x${string}`
  tokenURI: string
  validator: `0x${string}`
  requestHash: `0x${string}`
  requestURI: string
  txHashes: {
    reputation: `0x${string}`
    validationRequest: `0x${string}`
    validationResponse: `0x${string}`
  }
  validationStatus: {
    validatorAddress: `0x${string}`
    agentId: string
    response: number
    responseHash: `0x${string}`
    tag: string
    lastUpdate: string
  }
}

export type ArcAgentBriefRecommendationAction =
  | 'hold'
  | 'top_up'
  | 'trim'
  | 'deploy_executor'
  | 'configure_circle'
  | 'create_circle_wallet'
  | 'load_policy'

export type ArcAgentBriefResult = {
  agentId: string
  generatedAt: string
  requestHash: `0x${string}`
  requestURI: string
  owner: `0x${string}`
  tokenURI: string
  validator: `0x${string}`
  validationStatus: {
    validatorAddress: `0x${string}`
    agentId: string
    response: number
    responseHash: `0x${string}`
    tag: string
    lastUpdate: string
  }
  treasury: {
    contractAddress?: `0x${string}`
    executorAddress?: `0x${string}`
    balanceUsdc?: number | null
    policy: {
      minThreshold: number
      targetBalance: number
      maxRebalanceAmount: number
    } | null
    evaluation: {
      status: 'below_min' | 'healthy' | 'above_target'
      action: 'hold' | 'top_up' | 'trim'
      amount: number
      reasonCodes: string[]
      message: string
    } | null
  }
  circle: {
    readiness: CircleReadiness
    walletSetId?: string
    notes: string[]
    walletCount: number
  }
  recommendation: {
    action: ArcAgentBriefRecommendationAction
    confidence: number
    headline: string
    detail: string
    nextSteps: string[]
  }
}

function readEnv(name: string) {
  return process.env[name]?.trim() || undefined
}

function requirePrivateKey(name: string): `0x${string}` {
  const value = readEnv(name)

  if (!value) {
    throw new Error(`${name} is missing.`)
  }

  if (!value.startsWith('0x') || value.length !== 66) {
    throw new Error(`${name} must be a 0x-prefixed 32-byte private key.`)
  }

  return value as `0x${string}`
}

function createArcAgentClients() {
  const ownerAccount = privateKeyToAccount(requirePrivateKey('OWNER_PRIVATE_KEY'))
  const validatorAccount = privateKeyToAccount(requirePrivateKey('VALIDATOR_PRIVATE_KEY'))

  if (ownerAccount.address.toLowerCase() !== arcAgentOwnerAddress.toLowerCase()) {
    throw new Error(`OWNER_PRIVATE_KEY does not match the registered agent owner ${arcAgentOwnerAddress}.`)
  }

  if (validatorAccount.address.toLowerCase() !== arcAgentValidatorAddress.toLowerCase()) {
    throw new Error(`VALIDATOR_PRIVATE_KEY does not match the registered validator ${arcAgentValidatorAddress}.`)
  }

  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(arcTestnetRpcUrl),
  })

  const ownerWalletClient = createWalletClient({
    account: ownerAccount,
    chain: arcTestnet,
    transport: http(arcTestnetRpcUrl),
  })

  const validatorWalletClient = createWalletClient({
    account: validatorAccount,
    chain: arcTestnet,
    transport: http(arcTestnetRpcUrl),
  })

  return {
    ownerWalletClient,
    publicClient,
    validatorAccount,
    validatorWalletClient,
  }
}

async function waitForReceipt(publicClient: ReturnType<typeof createPublicClient>, hash: `0x${string}`) {
  return publicClient.waitForTransactionReceipt({
    hash,
    pollingInterval: 1000,
  })
}

function createArcTestnetPublicClient() {
  return createPublicClient({
    chain: arcTestnet,
    transport: http(arcTestnetRpcUrl),
  })
}

function deriveArcAgentRecommendation(params: {
  circleNotes: string[]
  circleReadiness: CircleReadiness
  executorAddress?: `0x${string}`
  policyAddress?: `0x${string}`
  policy: ArcAgentBriefResult['treasury']['policy']
  balanceUsdc: number | null
  evaluation: ArcAgentBriefResult['treasury']['evaluation']
}): ArcAgentBriefResult['recommendation'] {
  const { circleNotes, circleReadiness, executorAddress, policyAddress, policy, balanceUsdc, evaluation } = params

  if (!policyAddress) {
    return {
      action: 'load_policy',
      confidence: 0.36,
      headline: 'Load the deployed TreasuryPolicy first.',
      detail: 'The agent cannot make a treasury call until the policy contract address is configured.',
      nextSteps: [
        'Set TREASURY_POLICY_ADDRESS in the deployment environment.',
        'Broadcast the TreasuryPolicy contract if it has not been deployed yet.',
        'Refresh the dashboard so the agent can read the live policy band.',
      ],
    }
  }

  if (!executorAddress) {
    return {
      action: 'deploy_executor',
      confidence: 0.48,
      headline: 'Deploy TreasuryExecutor before moving funds.',
      detail: 'The policy is visible, but the treasury cannot execute USDC movement until the executor is deployed.',
      nextSteps: [
        'Deploy TreasuryExecutor from the owner wallet.',
        'Write TREASURY_EXECUTOR_ADDRESS into the environment.',
        'Run the brief again after the executor address is live.',
      ],
    }
  }

  if (!circleReadiness.apiKeyConfigured || !circleReadiness.entitySecretConfigured) {
    return {
      action: 'configure_circle',
      confidence: 0.44,
      headline: 'Circle developer wallet secrets still need to be configured.',
      detail: 'The Arc agent can still reason about policy, but the wallet and bridge rails are incomplete.',
      nextSteps: [
        'Set CIRCLE_API_KEY and CIRCLE_ENTITY_SECRET.',
        'Create or register a Circle wallet set.',
        'Reconnect the brief after the Circle control plane is ready.',
      ],
    }
  }

  if (!circleReadiness.walletSetConfigured) {
    return {
      action: 'create_circle_wallet',
      confidence: 0.56,
      headline: 'Create a Circle wallet set so the agent can operate.',
      detail: 'The developer wallet control plane is ready enough to bootstrap, but the wallet set is not configured yet.',
      nextSteps: [
        'Create the Circle wallet set from the dashboard.',
        'Provision a dev-controlled wallet on Arc Testnet.',
        'Re-run the brief to confirm the live wallet and bridge rails.',
      ],
    }
  }

  if (balanceUsdc === null) {
    return {
      action: 'hold',
      confidence: 0.52,
      headline: 'Treasury balance is still loading.',
      detail: 'The agent can see the policy and Circle readiness, but the live treasury balance is not available yet.',
      nextSteps: [
        'Wait for the executor balance read to resolve.',
        'Refresh the dashboard once the balance appears.',
        'Re-run the brief to get a concrete move recommendation.',
      ],
    }
  }

  if (evaluation?.status === 'below_min' && evaluation.amount > 0) {
    return {
      action: 'top_up',
      confidence: 0.9,
      headline: `Top up ${formatUsdc(evaluation.amount)} USDC toward target.`,
      detail: `Treasury balance is below the minimum threshold with ${formatUsdc(balanceUsdc)} USDC available on the executor path.`,
      nextSteps: [
        'Connect the owner wallet on Arc Testnet.',
        'Approve and execute the top-up through TreasuryExecutor.',
        'Re-run the brief to confirm the treasury is back in band.',
      ],
    }
  }

  if (evaluation?.status === 'above_target' && evaluation.amount > 0) {
    return {
      action: 'trim',
      confidence: 0.9,
      headline: `Trim ${formatUsdc(evaluation.amount)} USDC back to target.`,
      detail: `Treasury balance is above target with ${formatUsdc(balanceUsdc)} USDC sitting on the executor path.`,
      nextSteps: [
        'Connect the owner wallet on Arc Testnet.',
        'Select a recipient and execute the trim.',
        'Re-run the brief after the treasury balance is reduced.',
      ],
    }
  }

  return {
    action: 'hold',
    confidence: 0.96,
    headline: 'Treasury is inside the policy band.',
    detail:
      circleNotes.length > 0
        ? `The treasury is healthy and Circle is almost ready. ${circleNotes[0]}`
        : 'The treasury is healthy and the agent should hold until the next policy change.',
    nextSteps: [
      policy
        ? `Keep the policy at ${formatUsdc(policy.minThreshold)} / ${formatUsdc(policy.targetBalance)} / ${formatUsdc(
            policy.maxRebalanceAmount,
          )} USDC.`
        : 'Keep the current policy band unchanged.',
      'Refresh the brief when the balance drifts or the Circle wallet set changes.',
      'Use the activity log to track the next onchain update.',
    ],
  }
}

export async function runArcAgentActivation(): Promise<ArcAgentActivationResult> {
  const {
    ownerWalletClient,
    publicClient,
    validatorAccount,
    validatorWalletClient,
  } = createArcAgentClients()

  const identityContract = getContract({
    address: arcAgentIdentityRegistryAddress,
    abi: identityAbi,
    client: publicClient,
  })

  const owner = await identityContract.read.ownerOf([arcAgentId])
  const tokenURI = await identityContract.read.tokenURI([arcAgentId])

  if (owner.toLowerCase() !== arcAgentOwnerAddress.toLowerCase()) {
    throw new Error(
      `Registered owner mismatch. Expected ${arcAgentOwnerAddress}, found ${owner}.`,
    )
  }

  const gasPrice = await publicClient.getGasPrice()
  const maxFeePerGas = gasPrice * 50n
  const maxPriorityFeePerGas = 10_000_000_000n
  const activationNonce = `${Date.now()}`
  const requestURI = `${arcAgentMetadataUri}#activation-${activationNonce}`
  const requestHash = keccak256(toHex(`arc_agent_activation_${arcAgentId.toString()}_${activationNonce}`))
  const feedbackHash = keccak256(toHex(`arc_agent_feedback_${arcAgentId.toString()}_${activationNonce}`))
  const zeroHash = `0x${'0'.repeat(64)}` as const

  const validationRequestTxHash = await ownerWalletClient.writeContract({
    address: arcAgentValidationRegistryAddress,
    abi: validationAbi,
    functionName: 'validationRequest',
    args: [validatorAccount.address, arcAgentId, requestURI, requestHash],
    gas: 220_000n,
    maxFeePerGas,
    maxPriorityFeePerGas,
  })
  await waitForReceipt(publicClient, validationRequestTxHash)

  const reputationTxHash = await validatorWalletClient.writeContract({
    address: arcAgentReputationRegistryAddress,
    abi: reputationAbi,
    functionName: 'giveFeedback',
    args: [
      arcAgentId,
      95n,
      0,
      'dashboard_activation',
      arcAgentMetadataUri,
      requestURI,
      'Arc agent activation from the dashboard.',
      feedbackHash,
    ],
    gas: 180_000n,
    maxFeePerGas,
    maxPriorityFeePerGas,
  })
  await waitForReceipt(publicClient, reputationTxHash)

  const validationResponseTxHash = await validatorWalletClient.writeContract({
    address: arcAgentValidationRegistryAddress,
    abi: validationAbi,
    functionName: 'validationResponse',
    args: [requestHash, 100, requestURI, zeroHash, arcAgentValidationTag],
    gas: 180_000n,
    maxFeePerGas,
    maxPriorityFeePerGas,
  })
  await waitForReceipt(publicClient, validationResponseTxHash)

  const validationContract = getContract({
    address: arcAgentValidationRegistryAddress,
    abi: validationAbi,
    client: publicClient,
  })

  const [validatorAddress, validationAgentId, response, responseHash, tag, lastUpdate] =
    (await validationContract.read.getValidationStatus([requestHash])) as ValidationStatus

  return {
    agentId: arcAgentId.toString(),
    owner,
    tokenURI,
    requestHash,
    requestURI,
    txHashes: {
      reputation: reputationTxHash,
      validationRequest: validationRequestTxHash,
      validationResponse: validationResponseTxHash,
    },
    validator: validatorAccount.address,
    validationStatus: {
      agentId: validationAgentId.toString(),
      lastUpdate: lastUpdate.toString(),
      response,
      responseHash,
      tag,
      validatorAddress,
    },
  }
}

export async function runArcAgentBrief(requestHash?: `0x${string}`): Promise<ArcAgentBriefResult> {
  const publicClient = createArcTestnetPublicClient()
  const contractAddress = treasuryPolicyAddressConfig.address
  const executorAddress = treasuryExecutorAddressConfig.address
  const config = await fetchCircleControlPlaneStatus({
    walletSetId: undefined,
  }).catch(() => null)

  const policy = contractAddress
    ? ((await publicClient.readContract({
        address: contractAddress,
        abi: treasuryPolicyContractAbi,
        functionName: 'getPolicy',
      })) as readonly [bigint, bigint, bigint])
    : null

  const balance = executorAddress
    ? await publicClient.getBalance({
        address: executorAddress,
      })
    : null

  const balanceUsdc = balance === null ? null : Number(formatUnits(balance, arcUsdcDecimals))
  const formattedPolicy = policy
    ? {
        minThreshold: Number(formatUnits(policy[0], arcTreasuryPolicyDecimals)),
        targetBalance: Number(formatUnits(policy[1], arcTreasuryPolicyDecimals)),
        maxRebalanceAmount: Number(formatUnits(policy[2], arcTreasuryPolicyDecimals)),
      }
    : null
  const evaluation = balanceUsdc !== null && formattedPolicy ? evaluatePolicy(balanceUsdc, formattedPolicy) : null
  const activeRequestHash =
    requestHash ?? arcAgentValidationRequestHash
  const identityContract = getContract({
    address: arcAgentIdentityRegistryAddress,
    abi: identityAbi,
    client: publicClient,
  })

  const owner = await identityContract.read.ownerOf([arcAgentId])
  const tokenURI = await identityContract.read.tokenURI([arcAgentId])
  const validationContract = getContract({
    address: arcAgentValidationRegistryAddress,
    abi: validationAbi,
    client: publicClient,
  })
  const zeroHash = `0x${'0'.repeat(64)}` as const
  const [validatorAddress, validationAgentId, response, responseHash, tag, lastUpdate] =
    ((await validationContract.read.getValidationStatus([activeRequestHash]).catch(() => [
      arcAgentValidatorAddress,
      arcAgentId,
      0,
      zeroHash,
      'pending',
      0n,
    ])) as ValidationStatus)

  const circleReadiness = config?.readiness ?? {
    apiKeyConfigured: false,
    entitySecretConfigured: false,
    gatewayConfigured: false,
    walletBlockchainConfigured: false,
    walletSetConfigured: false,
  }
  const circleWalletSetId = config?.config?.walletSetId
  const circleNotes = config?.notes ?? []
  const recommendation = deriveArcAgentRecommendation({
    balanceUsdc,
    circleNotes,
    circleReadiness,
    executorAddress,
    policyAddress: contractAddress,
    policy: formattedPolicy,
    evaluation,
  })

  return {
    agentId: arcAgentId.toString(),
    circle: {
      notes: circleNotes,
      readiness: circleReadiness,
      walletCount: config?.wallets?.length ?? 0,
      walletSetId: circleWalletSetId,
    },
    generatedAt: new Date().toISOString(),
    owner,
    recommendation,
    requestHash: activeRequestHash,
    requestURI: `${arcAgentMetadataUri}#brief-${Date.now()}`,
    tokenURI,
    treasury: {
      balanceUsdc,
      contractAddress,
      evaluation,
      executorAddress,
      policy: formattedPolicy,
    },
    validator: validatorAddress,
    validationStatus: {
      agentId: validationAgentId.toString(),
      lastUpdate: lastUpdate.toString(),
      response,
      responseHash,
      tag,
      validatorAddress,
    },
  }
}
