'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  useAccount,
  useBalance,
  useConnect,
  useDisconnect,
  usePublicClient,
  useReadContract,
  useWalletClient,
  useSwitchChain,
  useWriteContract,
} from 'wagmi'
import {
  Activity,
  ArrowRightLeft,
  Bot,
  Copy,
  ExternalLink,
  ShieldCheck,
  FileText,
  RefreshCcw,
  Send,
  Wallet,
} from 'lucide-react'
import {
  ACTIVITY_LOG_STORAGE_KEY,
  circleSkillCatalog,
  circleSkillsPageUrl,
  circleStackConfig,
  circleStackSummary,
  circleTransferModeLabel,
  circleWalletModeLabel,
  circleWalletSetLocalStorageKey,
  arcTestnetChainId,
  arcTestnetExplorerUrl,
  arcUsdcAddress,
  arcUsdcDecimals,
  DEFAULT_TREASURY_POLICY,
  evaluatePolicy,
  formatUsdc,
  erc20ContractAbi,
  treasuryPolicyContractAbi,
  treasuryPolicyUpdatedEvent,
  treasuryExecutorContractAbi,
  treasuryExecutorContractBytecode,
  type ActivityEntry,
  type TreasuryPolicy,
  truncateAddress,
} from '@arc-usdc-rebalancer/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { SiteHeader } from '@/components/site-header'
import { readJson, writeJson } from '@/lib/storage'
import {
  arcTestnetRpcUrl,
  formatTreasuryPolicyAmount,
  formatTreasuryPolicyFromUnits,
  parseTreasuryPolicyToUnits,
  treasuryPolicyAddressConfig,
} from '@/lib/treasury-policy'
import {
  treasuryExecutorAddressConfig,
  treasuryExecutorLocalStorageKey,
} from '@/lib/treasury-executor'
import { arcTestnet } from '@/lib/wagmi'
import { parseUnits, type Address } from 'viem'
import {
  arcAgentId,
  arcAgentActivationReputationTag,
  arcAgentIdentityAbi,
  arcAgentIdentityRegistryAddress,
  arcAgentMetadataUri,
  arcAgentOwnerAddress,
  arcAgentValidationAbi,
  arcAgentValidationRegistryAddress,
  arcAgentValidationRequestHash,
  arcAgentValidationStorageKey,
  arcAgentValidationTag,
  arcAgentValidatorAddress,
} from '@/lib/arc-agent'

type TreasuryPolicyUpdatedLog = {
  args: {
    owner: `0x${string}`
    minThreshold: bigint
    targetBalance: bigint
    maxRebalanceAmount: bigint
  }
  blockNumber?: bigint
  transactionHash?: `0x${string}`
}

function statusTone(status: 'below_min' | 'healthy' | 'above_target') {
  if (status === 'healthy') {
    return 'success' as const
  }

  return 'warning' as const
}

function formatTimestamp(value: string) {
  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function policiesEqual(left: TreasuryPolicy, right: TreasuryPolicy) {
  return (
    left.minThreshold === right.minThreshold &&
    left.targetBalance === right.targetBalance &&
    left.maxRebalanceAmount === right.maxRebalanceAmount
  )
}

function formatTx(value?: string) {
  if (!value) {
    return '--'
  }

  return truncateAddress(value, 10, 8)
}

function activityBadgeVariant(tone: ActivityEntry['tone']) {
  return tone === 'success' ? ('success' as const) : ('outline' as const)
}

type StablecoinRobotStatus = 'pass' | 'warn' | 'wait'

function robotStatusVariant(status: StablecoinRobotStatus) {
  if (status === 'pass') {
    return 'success' as const
  }

  if (status === 'warn') {
    return 'warning' as const
  }

  return 'outline' as const
}

type CircleControlPlaneStatus = {
  config?: {
    gatewayDestinationDomain?: number
    gatewaySourceDomain?: number
    walletAccountType?: string
    walletBlockchain?: string
    walletSetId?: string | null
  }
  gatewayBalances?: {
    balances?: Array<{
      balance?: string
      depositor?: string
      domain?: number
    }>
    token?: string
  } | null
  gatewayInfo?: {
    domains?: Array<{
      chain?: string
      domain?: number
      minterContract?: {
        address?: string
        supportedTokens?: string[]
      }
      network?: string
      walletContract?: {
        address?: string
        supportedTokens?: string[]
      }
    }>
    version?: number
  } | null
  notes?: string[]
  readiness?: {
    apiKeyConfigured?: boolean
    entitySecretConfigured?: boolean
    gatewayConfigured?: boolean
    walletBlockchainConfigured?: boolean
    walletSetConfigured?: boolean
  }
  walletSet?: {
    createDate?: string
    custodyType?: string
    id?: string
    name?: string
    updateDate?: string
  } | null
  wallets?: Array<{
    accountType?: string
    address?: string
    blockchain?: string
    createDate?: string
    custodyType?: string
    id?: string
    name?: string
    refId?: string
    state?: string
    updateDate?: string
    walletSetId?: string
  }>
}

type ArcAgentActivationResult = {
  agentId: string
  owner: `0x${string}`
  requestHash: `0x${string}`
  requestURI: string
  tokenURI: string
  txHashes: {
    reputation: `0x${string}`
    validationRequest: `0x${string}`
    validationResponse: `0x${string}`
  }
  validationStatus: {
    agentId: string
    lastUpdate: string
    response: number
    responseHash: `0x${string}`
    tag: string
    validatorAddress: `0x${string}`
  }
  validator: `0x${string}`
}

type ArcAgentBriefResult = {
  agentId: string
  generatedAt: string
  requestHash: `0x${string}`
  requestURI: string
  owner: `0x${string}`
  tokenURI: string
  validator: `0x${string}`
  validationStatus: {
    agentId: string
    lastUpdate: string
    response: number
    responseHash: `0x${string}`
    tag: string
    validatorAddress: `0x${string}`
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
    readiness: {
      apiKeyConfigured: boolean
      entitySecretConfigured: boolean
      gatewayConfigured: boolean
      walletBlockchainConfigured: boolean
      walletSetConfigured: boolean
    }
    walletSetId?: string
    notes: string[]
    walletCount: number
  }
  recommendation: {
    action:
      | 'hold'
      | 'top_up'
      | 'trim'
      | 'deploy_executor'
      | 'configure_circle'
      | 'create_circle_wallet'
      | 'load_policy'
    confidence: number
    headline: string
    detail: string
    nextSteps: string[]
  }
}

function formatArcAgentRecommendationAction(action: ArcAgentBriefResult['recommendation']['action']) {
  switch (action) {
    case 'hold':
      return 'Hold'
    case 'top_up':
      return 'Top up'
    case 'trim':
      return 'Trim'
    case 'deploy_executor':
      return 'Deploy executor'
    case 'configure_circle':
      return 'Configure Circle'
    case 'create_circle_wallet':
      return 'Create wallet'
    case 'load_policy':
      return 'Load policy'
    default:
      return action
  }
}

const publicLaunchPath = [
  {
    step: '01',
    title: 'Pick a demo state',
    description:
      'Load a public scenario first so visitors can understand the treasury behavior before any live signing.',
  },
  {
    step: '02',
    title: 'Run the brief',
    description:
      'Let the Arc agent explain the recommended action, the policy band, and the current readiness state.',
  },
  {
    step: '03',
    title: 'Review evidence',
    description:
      'Open the repo notes, live demo, and activity log so the build stays auditable from GitHub to chain.',
  },
]

const builderReferenceLinks = [
  {
    label: 'Live demo',
    value: 'web-eight-chi-99.vercel.app/dashboard',
    href: 'https://web-eight-chi-99.vercel.app/dashboard',
  },
  {
    label: 'GitHub repo',
    value: 'sin199/arc-usdc-rebalancer',
    href: 'https://github.com/sin199/arc-usdc-rebalancer',
  },
  {
    label: 'Builder notes',
    value: 'docs/arc-builder-notes.md',
    href: 'https://github.com/sin199/arc-usdc-rebalancer/blob/main/docs/arc-builder-notes.md',
  },
]

export function TreasuryDashboard() {
  const { address, chainId, isConnected } = useAccount()
  const { connectors, connectAsync, isPending: isConnecting } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: arcTestnet.id })
  const { data: walletClient } = useWalletClient({ chainId: arcTestnet.id })
  const { writeContractAsync, isPending: isWriting } = useWriteContract()
  const contractAddress = treasuryPolicyAddressConfig.address
  const [localExecutorAddress, setLocalExecutorAddress] = useState<string | undefined>()
  const executorAddress = treasuryExecutorAddressConfig.address ?? localExecutorAddress
  const walletOnArc = isConnected && chainId === arcTestnet.id
  const walletSummary = isConnected && address ? truncateAddress(address) : 'No wallet connected'

  const walletBalanceQuery = useBalance({
    address,
    chainId: arcTestnet.id,
    query: {
      enabled: Boolean(address),
    },
  })

  const treasuryBalanceAddress = (executorAddress ?? address) as Address | undefined
  const treasuryBalanceQuery = useBalance({
    address: treasuryBalanceAddress,
    chainId: arcTestnet.id,
    query: {
      enabled: Boolean(treasuryBalanceAddress),
    },
  })

  const policyQuery = useReadContract({
    abi: treasuryPolicyContractAbi,
    address: contractAddress,
    chainId: arcTestnet.id,
    functionName: 'getPolicy',
    query: {
      enabled: Boolean(contractAddress),
    },
  })

  const ownerQuery = useReadContract({
    abi: treasuryPolicyContractAbi,
    address: contractAddress,
    chainId: arcTestnet.id,
    functionName: 'owner',
    query: {
      enabled: Boolean(contractAddress),
    },
  })

  const latestPolicyEventQuery = useQuery<TreasuryPolicyUpdatedLog | null>({
    queryKey: ['treasury-policy-latest-event', contractAddress],
    queryFn: async () => {
      if (!publicClient || !contractAddress) {
        return null
      }

      const logs = await publicClient.getLogs({
        address: contractAddress,
        event: treasuryPolicyUpdatedEvent,
        fromBlock: 0n,
        toBlock: 'latest',
      })

      return (logs.at(-1) ?? null) as TreasuryPolicyUpdatedLog | null
    },
    enabled: Boolean(publicClient && contractAddress),
    refetchInterval: 15_000,
    staleTime: 5_000,
  })

  const [draftPolicy, setDraftPolicy] = useState<TreasuryPolicy>(DEFAULT_TREASURY_POLICY)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [simulationMessage, setSimulationMessage] = useState<string>(
    'Public demo mode is ready. Try the sample treasury scenarios or connect a wallet for live signing.',
  )
  const [stablecoinTestMessage, setStablecoinTestMessage] = useState<string>(
    'Run the stablecoin robot test to inspect the public demo or live USDC policy state.',
  )
  const [stablecoinExecutionMessage, setStablecoinExecutionMessage] = useState<string>(
    'Server signer execution will submit the current policy to chain.',
  )
  const [executorDeployMessage, setExecutorDeployMessage] = useState<string>(
    'Deploy TreasuryExecutor in live mode, or simulate it in public demo mode.',
  )
  const [circleStatusMessage, setCircleStatusMessage] = useState<string>(
    'Refresh the Circle control plane or create a dev wallet to start the live wallet and bridge flow.',
  )
  const [circleCreateMessage, setCircleCreateMessage] = useState<string>(
    'Circle wallet creation will provision a dev-controlled wallet on Arc Testnet.',
  )
  const [localArcAgentValidationRequestHash, setLocalArcAgentValidationRequestHash] = useState<
    string | undefined
  >()
  const [arcAgentWakeMessage, setArcAgentWakeMessage] = useState<string>(
    'Wake the agent to run a fresh reputation and validation round.',
  )
  const [arcAgentWakeInFlight, setArcAgentWakeInFlight] = useState(false)
  const [lastArcAgentActivation, setLastArcAgentActivation] = useState<ArcAgentActivationResult | null>(null)
  const [arcAgentBriefMessage, setArcAgentBriefMessage] = useState<string>(
    'Run a brief to turn the agent state into a concrete operational step.',
  )
  const [arcAgentBriefInFlight, setArcAgentBriefInFlight] = useState(false)
  const [lastArcAgentBrief, setLastArcAgentBrief] = useState<ArcAgentBriefResult | null>(null)
  const [agentTakeoverMessage, setAgentTakeoverMessage] = useState<string>(
    'Run the takeover cycle to let the agent refresh Circle, load policy, brief, and act from one place.',
  )
  const [agentTakeoverInFlight, setAgentTakeoverInFlight] = useState(false)
  const [lastAgentTakeoverAt, setLastAgentTakeoverAt] = useState<string | null>(null)
  const [localCircleWalletSetId, setLocalCircleWalletSetId] = useState<string | undefined>()
  const [circleWalletCreationInFlight, setCircleWalletCreationInFlight] = useState(false)
  const [lastValidationError, setLastValidationError] = useState<string | null>(null)
  const [submissionInFlight, setSubmissionInFlight] = useState(false)
  const [executorDeploymentInFlight, setExecutorDeploymentInFlight] = useState(false)
  const [demoPolicy, setDemoPolicy] = useState<TreasuryPolicy | null>(null)
  const [demoTreasuryBalance, setDemoTreasuryBalance] = useState<number | null>(null)
  const chainPolicyInitializedRef = useRef(false)
  const configuredCircleWalletSetId = process.env.NEXT_PUBLIC_CIRCLE_WALLET_SET_ID?.trim() || undefined
  const circleWalletSetId = configuredCircleWalletSetId ?? localCircleWalletSetId
  const activeArcAgentValidationRequestHash = (
    localArcAgentValidationRequestHash?.startsWith('0x')
      ? localArcAgentValidationRequestHash
      : arcAgentValidationRequestHash
  ) as `0x${string}`

  const circleStatusQuery = useQuery<CircleControlPlaneStatus>({
    queryKey: ['circle-control-plane', circleWalletSetId, address],
    queryFn: async () => {
      const searchParams = new URLSearchParams()

      if (circleWalletSetId) {
        searchParams.set('walletSetId', circleWalletSetId)
      }

      if (address) {
        searchParams.set('depositor', address)
      }

      const response = await fetch(`/api/circle/status?${searchParams.toString()}`, {
        cache: 'no-store',
      })

      if (!response.ok) {
        const error = await response.json().catch(() => ({}))
        throw new Error(error.error ?? `Circle status request failed with ${response.status}.`)
      }

      return (await response.json()) as CircleControlPlaneStatus
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  })

  const arcAgentOwnerQuery = useReadContract({
    abi: arcAgentIdentityAbi,
    address: arcAgentIdentityRegistryAddress,
    chainId: arcTestnet.id,
    functionName: 'ownerOf',
    args: [arcAgentId],
    query: {
      refetchInterval: 30_000,
      staleTime: 10_000,
    },
  })

  const arcAgentTokenUriQuery = useReadContract({
    abi: arcAgentIdentityAbi,
    address: arcAgentIdentityRegistryAddress,
    chainId: arcTestnet.id,
    functionName: 'tokenURI',
    args: [arcAgentId],
    query: {
      refetchInterval: 30_000,
      staleTime: 10_000,
    },
  })

  const arcAgentValidationQuery = useReadContract({
    abi: arcAgentValidationAbi,
    address: arcAgentValidationRegistryAddress,
    chainId: arcTestnet.id,
    functionName: 'getValidationStatus',
    args: [activeArcAgentValidationRequestHash],
    query: {
      refetchInterval: 30_000,
      staleTime: 10_000,
    },
  })

  const liveChainPolicy = policyQuery.data ? formatTreasuryPolicyFromUnits(policyQuery.data) : null
  const ownerAddress = ownerQuery.data
  const ownerWalletBalance = walletBalanceQuery.data ? Number(walletBalanceQuery.data.formatted ?? 0) : null
  const connectedWalletIsOwner =
    address !== undefined &&
    ownerAddress !== undefined &&
    address.toLowerCase() === ownerAddress.toLowerCase()
  const liveOperatorAvailable = Boolean(isConnected && walletOnArc && connectedWalletIsOwner)
  const publicDemoMode = !liveOperatorAvailable
  const chainPolicy = liveOperatorAvailable ? liveChainPolicy : demoPolicy ?? liveChainPolicy

  const currentPolicy = chainPolicy ?? draftPolicy
  const publicDemoPreviewBalance = Math.max(0, currentPolicy.minThreshold - 25)
  const treasuryBalance = liveOperatorAvailable
    ? Number(treasuryBalanceQuery.data?.formatted ?? 0)
    : demoTreasuryBalance ?? publicDemoPreviewBalance
  const evaluation = evaluatePolicy(treasuryBalance, currentPolicy)
  const stablecoinExecutionFloor = 0.01
  const stablecoinExecutionRequestedAmount =
    evaluation && evaluation.amount > 0 ? evaluation.amount : stablecoinExecutionFloor
  const stablecoinExecutionAction: 'top_up' | 'trim' =
    evaluation?.action === 'trim' && evaluation.amount > 0 ? 'trim' : 'top_up'
  const stablecoinExecutionAmount =
    stablecoinExecutionAction === 'top_up' && liveOperatorAvailable && ownerWalletBalance !== null
      ? Math.min(stablecoinExecutionRequestedAmount, ownerWalletBalance)
      : stablecoinExecutionRequestedAmount
  const stablecoinExecutionIsCapped =
    stablecoinExecutionAction === 'top_up' &&
    liveOperatorAvailable &&
    ownerWalletBalance !== null &&
    stablecoinExecutionRequestedAmount > ownerWalletBalance
  const hasUnsavedChanges = Boolean(chainPolicy) && !policiesEqual(draftPolicy, chainPolicy as TreasuryPolicy)
  const stablecoinBalance = treasuryBalance
  const stablecoinRobotStatus: StablecoinRobotStatus = !contractAddress && !publicDemoMode
    ? 'wait'
    : evaluation?.status === 'healthy'
      ? 'pass'
      : 'warn'
  const stablecoinRobotConfidence = stablecoinRobotStatus === 'pass' ? 0.96 : stablecoinRobotStatus === 'warn' ? 0.72 : 0.25
  const stablecoinRobotReasonCodes = publicDemoMode
    ? ['PUBLIC_DEMO_MODE', ...(evaluation?.reasonCodes ?? ['POLICY_READ_ONLY'])]
    : !contractAddress
      ? ['MISSING_POLICY_ADDRESS']
      : !chainPolicy
        ? ['POLICY_LOADING']
        : liveOperatorAvailable && !walletOnArc
          ? ['SWITCH_TO_ARC_TESTNET']
          : liveOperatorAvailable && !executorAddress
            ? ['MISSING_EXECUTOR_ADDRESS']
            : [...(evaluation?.reasonCodes ?? ['POLICY_READ_ONLY'])]
  const stablecoinRobotExecutionReady = Boolean(
    !submissionInFlight &&
      formatValidationError(draftPolicy) === null &&
      (publicDemoMode || (contractAddress && chainPolicy && executorAddress && liveOperatorAvailable)),
  )
  const stablecoinRobotExecutionReason = !contractAddress && !publicDemoMode
    ? 'Set TREASURY_POLICY_ADDRESS before executing live.'
    : !chainPolicy
      ? 'Load the deployed policy before executing live.'
      : liveOperatorAvailable && !walletOnArc
        ? 'Switch the wallet to Arc Testnet before live execution.'
        : liveOperatorAvailable && !executorAddress
          ? 'Set TREASURY_EXECUTOR_ADDRESS before live execution.'
          : formatValidationError(draftPolicy) ?? (publicDemoMode ? 'Public demo mode is ready.' : 'Execution is temporarily blocked.')
  const stablecoinEvaluationMessage = evaluation?.message ?? 'Treasury balance is outside the healthy band.'
  const stablecoinRobotSummary =
    stablecoinRobotStatus === 'pass'
      ? 'USDC balance is inside the healthy policy band.'
      : stablecoinRobotStatus === 'warn'
        ? `Policy test indicates ${stablecoinEvaluationMessage.toLowerCase()}.`
        : 'Public demo mode is ready to run the stablecoin policy test.'
  const stablecoinRobotChecks = [
    {
      label: 'Session mode',
      passed: true,
      detail: liveOperatorAvailable
        ? 'Live operator mode is active with a wallet on Arc Testnet.'
        : 'Public demo mode is active. Connect any wallet for live signing.',
    },
    {
      label: 'Arc Testnet',
      passed: publicDemoMode || walletOnArc,
      detail: walletOnArc
        ? 'Wallet is pointed at Arc Testnet.'
        : 'Public demo mode can preview the policy without a wallet.',
    },
    {
      label: 'Policy loaded',
      passed: Boolean(currentPolicy),
      detail: chainPolicy
        ? 'Deployed TreasuryPolicy values are available.'
        : 'Public demo mode is using the draft policy in this session.',
    },
    {
      label: 'Executor loaded',
      passed: publicDemoMode || Boolean(executorAddress),
      detail: executorAddress
        ? 'TreasuryExecutor is configured for USDC movements.'
        : 'Public demo mode will simulate executor setup locally.',
    },
    {
      label: 'Treasury balance',
      passed: evaluation?.status === 'healthy',
      detail:
        evaluation?.status === 'healthy'
          ? 'Treasury balance sits inside the policy band.'
          : evaluation?.message ?? 'Awaiting live policy evaluation.',
    },
    {
      label: 'Execution amount',
      passed: stablecoinExecutionAmount > 0,
      detail:
        evaluation && evaluation.amount > 0
          ? stablecoinExecutionIsCapped
            ? `Requested ${formatUsdc(stablecoinExecutionRequestedAmount)} USDC exceeds the live wallet balance of ${formatUsdc(ownerWalletBalance ?? 0)} USDC, so the execution amount is capped to ${formatUsdc(stablecoinExecutionAmount)} USDC.`
            : `Execution amount ${formatUsdc(stablecoinExecutionAmount)} USDC will be submitted.`
          : publicDemoMode
            ? `Demo floor ${formatUsdc(stablecoinExecutionFloor)} USDC will be simulated locally.`
            : `Test floor ${formatUsdc(stablecoinExecutionFloor)} USDC will be submitted to exercise MetaMask.`,
    },
  ]

  const circleStackStatus: StablecoinRobotStatus = !contractAddress
    ? 'wait'
    : chainPolicy && (publicDemoMode || (walletOnArc && executorAddress))
      ? 'pass'
      : 'warn'
  const circleStackStatusLabel =
    circleStackStatus === 'pass' ? 'READY' : circleStackStatus === 'warn' ? 'WIRING NEEDED' : 'WAIT'
  const circleStackChecks = [
    {
      label: 'Wallet mode',
      passed: true,
      detail: `Configured for ${circleWalletModeLabel(circleStackConfig.walletMode)}.`,
    },
    {
      label: 'Bridge rail',
      passed: true,
      detail: `${circleTransferModeLabel(circleStackConfig.transferMode)} for ${circleStackConfig.sourceChain} → ${circleStackConfig.destinationChain}.`,
    },
    {
      label: 'Arc Testnet',
      passed: publicDemoMode || walletOnArc,
      detail: walletOnArc
        ? `Wallet is on Arc Testnet (chain ${arcTestnetChainId}).`
        : 'Public demo mode can preview the Arc line without a connected wallet.',
    },
    {
      label: 'Live operator',
      passed: liveOperatorAvailable,
      detail: liveOperatorAvailable
        ? 'Connected wallet matches the TreasuryPolicy operator and is on Arc Testnet.'
        : 'Public demo mode is active. Connect the live operator wallet only for live execution.',
    },
    {
      label: 'Treasury policy',
      passed: Boolean(currentPolicy),
      detail: chainPolicy
        ? 'TreasuryPolicy is loaded from chain.'
        : 'Public demo mode is using the draft policy in this session.',
    },
    {
      label: 'Treasury executor',
      passed: publicDemoMode || Boolean(executorAddress),
      detail: executorAddress
        ? `TreasuryExecutor configured at ${truncateAddress(executorAddress)}.`
        : 'Public demo mode will simulate treasury execution locally.',
    },
  ]

  const arcAgentOwner = arcAgentOwnerQuery.data
  const arcAgentTokenUri = arcAgentTokenUriQuery.data ?? arcAgentMetadataUri
  const arcAgentValidation = arcAgentValidationQuery.data
  const arcAgentValidationValidator = arcAgentValidation?.[0]
  const arcAgentValidationResponse = arcAgentValidation?.[2]
  const arcAgentValidationTagValue = arcAgentValidation?.[4]
  const arcAgentValidationLastUpdate = arcAgentValidation?.[5]
  const arcAgentOwnerMatches =
    typeof arcAgentOwner === 'string' && arcAgentOwner.toLowerCase() === arcAgentOwnerAddress.toLowerCase()
  const arcAgentInstalled = Boolean(arcAgentOwner)
  const arcAgentVerified = arcAgentValidationResponse === 100
  const arcAgentStatusTone: 'success' | 'warning' = arcAgentVerified ? 'success' : 'warning'
  const arcAgentStatusLabel = arcAgentVerified ? 'VERIFIED' : arcAgentInstalled ? 'INSTALLED' : 'CHECK'

  useEffect(() => {
    const storedActivity = readJson<ActivityEntry[]>(ACTIVITY_LOG_STORAGE_KEY, [])
    const initialActivity =
      storedActivity.length > 0
        ? storedActivity
        : [
            {
              id: crypto.randomUUID(),
              title: 'Dashboard ready',
              detail:
                treasuryPolicyAddressConfig.status === 'configured'
                  ? 'TreasuryPolicy address loaded and ready for Arc Testnet reads.'
                  : 'Set TREASURY_POLICY_ADDRESS to load the deployed TreasuryPolicy contract.',
              createdAt: new Date().toISOString(),
              tone: treasuryPolicyAddressConfig.status === 'configured' ? 'success' : 'warning',
            } satisfies ActivityEntry,
          ]

    setActivity(initialActivity)
    writeJson(ACTIVITY_LOG_STORAGE_KEY, initialActivity)
  }, [])

  useEffect(() => {
    if (!chainPolicy || chainPolicyInitializedRef.current) {
      return
    }

    chainPolicyInitializedRef.current = true
    setDraftPolicy(chainPolicy)
  }, [chainPolicy])

  useEffect(() => {
    if (!chainPolicy) {
      setSimulationMessage(
        treasuryPolicyAddressConfig.status === 'configured'
          ? 'Load the deployed policy to simulate against live Arc Testnet state.'
          : 'Set the deployed TreasuryPolicy address to enable live policy reads and live operator writes.',
      )
    }
  }, [chainPolicy])

  useEffect(() => {
    const storedExecutor = window.localStorage.getItem(treasuryExecutorLocalStorageKey)
    if (storedExecutor && !treasuryExecutorAddressConfig.address) {
      setLocalExecutorAddress(storedExecutor)
    }
  }, [])

  useEffect(() => {
    if (!localExecutorAddress) {
      return
    }

    window.localStorage.setItem(treasuryExecutorLocalStorageKey, localExecutorAddress)
  }, [localExecutorAddress])

  useEffect(() => {
    const storedWalletSetId = window.localStorage.getItem(circleWalletSetLocalStorageKey)
    if (storedWalletSetId && !process.env.NEXT_PUBLIC_CIRCLE_WALLET_SET_ID?.trim()) {
      setLocalCircleWalletSetId(storedWalletSetId)
    }
  }, [])

  useEffect(() => {
    if (!localCircleWalletSetId) {
      return
    }

    window.localStorage.setItem(circleWalletSetLocalStorageKey, localCircleWalletSetId)
  }, [localCircleWalletSetId])

  useEffect(() => {
    const storedArcAgentValidationRequestHash = window.localStorage.getItem(arcAgentValidationStorageKey)
    if (storedArcAgentValidationRequestHash?.startsWith('0x')) {
      setLocalArcAgentValidationRequestHash(storedArcAgentValidationRequestHash)
    }
  }, [])

  useEffect(() => {
    if (!localArcAgentValidationRequestHash) {
      return
    }

    window.localStorage.setItem(arcAgentValidationStorageKey, localArcAgentValidationRequestHash)
  }, [localArcAgentValidationRequestHash])

  function pushActivity(entry: Omit<ActivityEntry, 'id' | 'createdAt'>) {
    const nextEntry: ActivityEntry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      ...entry,
    }

    setActivity((current) => {
      const next = [nextEntry, ...current].slice(0, 12)
      writeJson(ACTIVITY_LOG_STORAGE_KEY, next)
      return next
    })
  }

  async function handleConnect(): Promise<Address | null> {
    const injectedConnector =
      connectors.find((connector) => /metamask/i.test(connector.name) || connector.id === 'metaMask') ??
      connectors.find((connector) => connector.type === 'injected') ??
      connectors[0]

    if (!injectedConnector) {
      pushActivity({
        title: 'No injected wallet found',
        detail: 'Install an injected wallet such as MetaMask or Rabby, then refresh the page.',
        tone: 'warning',
      })
      return null
    }

    try {
      const result = await connectAsync({ connector: injectedConnector })
      const connectedAddress = result.accounts[0] as Address | undefined
      pushActivity({
        title: 'Wallet connected',
        detail: `Connected through ${injectedConnector.name} and ready for Arc Testnet.`,
        tone: 'success',
      })
      setSimulationMessage('Wallet connected. Review the live policy or use public demo mode to explore the dashboard.')
      return connectedAddress ?? null
    } catch {
      pushActivity({
        title: 'Wallet connection failed',
        detail: 'The injected wallet rejected the connection request.',
        tone: 'warning',
      })
      return null
    }
  }

  function handleDisconnect() {
    disconnect()
    setSimulationMessage('Wallet disconnected. Public demo mode stays available without a wallet.')
    pushActivity({
      title: 'Wallet disconnected',
      detail: 'The dashboard cleared the active wallet connection.',
      tone: 'neutral',
    })
  }

  async function handleSwitchChain() {
    try {
      await switchChainAsync({ chainId: arcTestnet.id })
      pushActivity({
        title: 'Switched to Arc Testnet',
        detail: `The wallet now targets chain ID ${arcTestnetChainId}.`,
        tone: 'success',
      })
      return true
    } catch {
      pushActivity({
        title: 'Network switch needs manual approval',
        detail: `Add or select Arc Testnet manually. RPC: ${arcTestnetRpcUrl}`,
        tone: 'warning',
      })
      return false
    }
  }

  async function handleCopyAddress() {
    if (!address) {
      return
    }

    try {
      await navigator.clipboard.writeText(address)
      pushActivity({
        title: 'Address copied',
        detail: `${truncateAddress(address)} copied to the clipboard.`,
        tone: 'neutral',
      })
    } catch {
      pushActivity({
        title: 'Clipboard unavailable',
        detail: 'The browser blocked clipboard access, so the address was not copied.',
        tone: 'warning',
      })
    }
  }

  function loadPublicDemoScenario(nextBalance: number, scenarioLabel: string) {
    if (liveOperatorAvailable) {
      return
    }

    setDemoTreasuryBalance(nextBalance)
    const nextEvaluation = evaluatePolicy(nextBalance, currentPolicy)
    setSimulationMessage(
      `Public demo mode: ${scenarioLabel}. ${nextEvaluation.message} The preview now reflects ${formatUsdc(nextBalance)} USDC.`,
    )
    pushActivity({
      title: 'Demo scenario loaded',
      detail: `${scenarioLabel} · treasury preview set to ${formatUsdc(nextBalance)} USDC.`,
      tone: nextEvaluation.status === 'healthy' ? 'success' : 'warning',
    })
  }

  async function handleRefreshChainPolicy() {
    if (!contractAddress) {
      setLastValidationError('Set TREASURY_POLICY_ADDRESS before loading the deployed policy.')
      pushActivity({
        title: 'Policy refresh blocked',
        detail: 'The deployed TreasuryPolicy address is missing or invalid.',
        tone: 'warning',
      })
      return
    }

    const result = await policyQuery.refetch()
    if (result.data) {
      const nextPolicy = formatTreasuryPolicyFromUnits(result.data)
      setDraftPolicy(nextPolicy)
      setLastValidationError(null)
      pushActivity({
        title: 'Policy loaded from chain',
        detail: `Min ${formatUsdc(nextPolicy.minThreshold)} | Target ${formatUsdc(nextPolicy.targetBalance)} | Max ${formatUsdc(nextPolicy.maxRebalanceAmount)}`,
        tone: 'success',
      })
    }

    await latestPolicyEventQuery.refetch()
  }

  async function submitPolicyUpdate() {
    const validationError = formatValidationError(draftPolicy)
    setLastValidationError(validationError)

    if (validationError) {
      pushActivity({
        title: 'Policy update blocked',
        detail: validationError,
        tone: 'warning',
      })
      return false
    }

    if (!liveOperatorAvailable) {
      setDemoPolicy(draftPolicy)
      setSimulationMessage('Public demo mode: policy draft saved locally for this browser session.')
      pushActivity({
        title: 'Policy update simulated',
        detail: 'Public demo mode accepted the draft locally. Connect the live operator wallet for a live chain update.',
        tone: 'success',
      })
      return true
    }

    if (!contractAddress) {
      setSimulationMessage('Set TREASURY_POLICY_ADDRESS before submitting a live policy update.')
      setLastValidationError('Deployed TreasuryPolicy address is missing or invalid.')
      return false
    }

    try {
      if (!publicClient) {
        throw new Error('Arc Testnet public client is unavailable.')
      }

      setSubmissionInFlight(true)
      const txHash = await writeContractAsync({
        abi: treasuryPolicyContractAbi,
        address: contractAddress,
        chainId: arcTestnet.id,
        functionName: 'setPolicy',
        args: parseTreasuryPolicyToUnits(draftPolicy),
      })

      setSimulationMessage(
        `Policy update submitted to TreasuryPolicy. Waiting for confirmation on Arc Testnet. Tx ${formatTx(txHash)}.`,
      )
      pushActivity({
        title: 'Policy update submitted',
        detail: `TreasuryPolicy transaction sent. Tx ${formatTx(txHash)}.`,
        tone: 'neutral',
      })

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
      const nextPolicy = draftPolicy

      setSimulationMessage(
        `Policy update confirmed in block ${receipt.blockNumber?.toString() ?? 'unknown'}. The dashboard is now aligned with the latest onchain policy.`,
      )
      pushActivity({
        title: 'Policy update confirmed',
        detail: `Confirmed in block ${receipt.blockNumber?.toString() ?? 'unknown'}.`,
        tone: 'success',
      })
      setLastValidationError(null)

      await Promise.all([
        policyQuery.refetch(),
        ownerQuery.refetch(),
        latestPolicyEventQuery.refetch(),
      ])

      setDraftPolicy(nextPolicy)
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setSimulationMessage(`Policy update failed: ${message}`)
      pushActivity({
        title: 'Policy update failed',
        detail: message,
        tone: 'warning',
      })
      return false
    } finally {
      setSubmissionInFlight(false)
    }
  }

  async function handleSubmitPolicy() {
    await submitPolicyUpdate()
  }

  function handleSimulateRebalance() {
    const result = evaluatePolicy(treasuryBalance, currentPolicy)
    const policySource = chainPolicy ? 'onchain policy' : 'draft policy'
    const summary =
      result.action === 'hold'
        ? `No rebalance required. Simulation used the ${policySource}.`
        : `${result.message} Simulation used the ${policySource}.`

    setSimulationMessage(summary)
    pushActivity({
      title: 'Rebalance simulated',
      detail: `${result.message} Reason codes: ${result.reasonCodes.join(', ')}.`,
      tone: statusTone(result.status),
    })
  }

  function handleRunStablecoinTest() {
    pushActivity({
      title: 'Stablecoin robot test',
      detail: `${stablecoinRobotSummary} Reasons: ${stablecoinRobotReasonCodes.join(', ')}. Execution amount ${formatUsdc(stablecoinExecutionAmount)} USDC.`,
      tone: stablecoinRobotStatus === 'pass' ? 'success' : stablecoinRobotStatus === 'warn' ? 'warning' : 'neutral',
    })

    setStablecoinTestMessage(
      `${stablecoinRobotStatus.toUpperCase()} | ${stablecoinRobotSummary} Treasury ${formatUsdc(stablecoinBalance)} USDC. Execution amount ${formatUsdc(stablecoinExecutionAmount)} USDC. ${stablecoinRobotExecutionReady ? 'Execution is ready.' : stablecoinRobotExecutionReason}`,
    )
  }

  async function handleExecuteStablecoinPolicy(): Promise<boolean> {
    if (submissionInFlight) {
      return false
    }

    const amountUnits = parseUnits(String(stablecoinExecutionAmount), arcUsdcDecimals)
    if (amountUnits <= 0n || !evaluation) {
      setStablecoinExecutionMessage('Execution skipped. No rebalance amount is required.')
      return false
    }

    if (!liveOperatorAvailable) {
      const nextTreasuryBalance =
        stablecoinExecutionAction === 'top_up'
          ? treasuryBalance + stablecoinExecutionAmount
          : Math.max(0, treasuryBalance - stablecoinExecutionAmount)
      setSubmissionInFlight(true)
      try {
        setDemoTreasuryBalance(nextTreasuryBalance)
        setStablecoinExecutionMessage(
          `Public demo mode: ${stablecoinExecutionAction === 'top_up' ? 'top-up' : 'trim'} simulated locally. No onchain transaction was sent.`,
        )
        pushActivity({
          title: stablecoinExecutionAction === 'top_up' ? 'Stablecoin top-up simulated' : 'Stablecoin trim simulated',
          detail: `Public demo mode adjusted the treasury preview by ${formatUsdc(stablecoinExecutionAmount)} USDC.`,
          tone: 'success',
        })
        setStablecoinTestMessage(
          `DEMO | ${stablecoinExecutionAction.toUpperCase()} simulated. Treasury ${formatUsdc(nextTreasuryBalance)} USDC.`,
        )
        return true
      } finally {
        setSubmissionInFlight(false)
      }
    }

    try {
      setSubmissionInFlight(true)
      setStablecoinExecutionMessage(`Submitting ${formatUsdc(stablecoinExecutionAmount)} USDC via the server signer...`)

      const response = await fetch('/api/treasury/execute', {
        body: JSON.stringify({
          action: stablecoinExecutionAction,
          amountUsdc: stablecoinExecutionAmount,
        }),
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })

      const payload = (await response.json().catch(() => ({}))) as {
        action?: 'top_up' | 'trim'
        amountUsdc?: number
        error?: string
        mode?: 'server'
        ownerAddress?: `0x${string}`
        recipient?: `0x${string}`
        summary?: string
        txHashes?: {
          approve?: `0x${string}`
          execute?: `0x${string}`
        }
      }

      if (!response.ok) {
        throw new Error(payload.error ?? `Treasury execution failed with ${response.status}.`)
      }

      const executedAction = payload.action ?? stablecoinExecutionAction
      const executedAmount = payload.amountUsdc ?? stablecoinExecutionAmount
      const executeHash = payload.txHashes?.execute
      const nextTreasuryBalance =
        executedAction === 'top_up'
          ? stablecoinBalance + executedAmount
          : Math.max(0, stablecoinBalance - executedAmount)

      setStablecoinExecutionMessage(payload.summary ?? 'Execution confirmed via the server signer.')
      pushActivity({
        title: executedAction === 'top_up' ? 'Stablecoin top-up executed' : 'Stablecoin trim executed',
        detail: `${payload.summary ?? `Live operator signer submitted ${formatUsdc(executedAmount)} USDC.`}${executeHash ? ` Tx ${formatTx(executeHash)}.` : ''}`,
        tone: 'success',
      })
      await treasuryBalanceQuery.refetch()
      await latestPolicyEventQuery.refetch()
      setStablecoinTestMessage(
        `EXECUTED | ${executedAction.toUpperCase()} confirmed. Treasury ${formatUsdc(nextTreasuryBalance)} USDC.`,
      )
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'

      if (liveOperatorAvailable) {
        setStablecoinExecutionMessage(`Server signer unavailable, falling back to the live operator wallet: ${message}`)
        const fallbackExecuted = await handleExecuteStablecoinPolicyViaWallet()
        if (fallbackExecuted) {
          return true
        }
      }

      setStablecoinExecutionMessage(`Execution failed: ${message}`)
      pushActivity({
        title: 'Stablecoin execution failed',
        detail: message,
        tone: 'warning',
      })
      return false
    } finally {
      setSubmissionInFlight(false)
    }
  }

  async function handleExecuteStablecoinPolicyViaWallet(): Promise<boolean> {
    let activeWalletAddress = address ?? null
    let activeExecutorAddress = executorAddress ?? null

    if (!activeWalletAddress) {
      setStablecoinExecutionMessage('Connecting the live operator wallet before execution...')
      activeWalletAddress = await handleConnect()
      if (!activeWalletAddress) {
        setStablecoinExecutionMessage('Execution blocked: connect the live operator wallet first.')
        return false
      }
    }

    if (!walletOnArc) {
      setStablecoinExecutionMessage('Switching the wallet to Arc Testnet before execution...')
      const switched = await handleSwitchChain()
      if (!switched) {
        setStablecoinExecutionMessage('Execution blocked: switch the wallet to Arc Testnet first.')
        return false
      }
    }

    if (!ownerAddress || activeWalletAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
      const reason = 'Only the live operator wallet can execute the policy update.'
      setStablecoinExecutionMessage(reason)
      pushActivity({
        title: 'Stablecoin execution blocked',
        detail: reason,
        tone: 'warning',
      })
      return false
    }

    if (!activeExecutorAddress) {
      setStablecoinExecutionMessage('Deploying TreasuryExecutor before execution...')
      activeExecutorAddress = activeWalletAddress
        ? await deployExecutorForWallet(activeWalletAddress)
        : await handleDeployExecutor()
      if (!activeExecutorAddress) {
        setStablecoinExecutionMessage('Execution blocked: deploy TreasuryExecutor first.')
        return false
      }
    }

    if (!publicClient || !activeExecutorAddress) {
      setStablecoinExecutionMessage('Execution failed. Treasury executor address or public client is unavailable.')
      return false
    }

    const amountUnits = parseUnits(String(stablecoinExecutionAmount), arcUsdcDecimals)
    if (amountUnits <= 0n || !evaluation) {
      setStablecoinExecutionMessage('Execution skipped. No rebalance amount is required.')
      return false
    }

    try {
      setSubmissionInFlight(true)

      if (stablecoinExecutionAction === 'top_up') {
        setStablecoinExecutionMessage(`Approving ${formatUsdc(stablecoinExecutionAmount)} USDC for the treasury executor...`)
        const approveHash = await writeContractAsync({
          abi: erc20ContractAbi,
          address: arcUsdcAddress,
          chainId: arcTestnet.id,
          functionName: 'approve',
          args: [activeExecutorAddress as Address, amountUnits],
        })

        pushActivity({
          title: 'Executor allowance submitted',
          detail: `USDC approve tx ${formatTx(approveHash)} sent for TreasuryExecutor.`,
          tone: 'neutral',
        })

        await publicClient.waitForTransactionReceipt({ hash: approveHash })

        setStablecoinExecutionMessage(`Depositing ${formatUsdc(stablecoinExecutionAmount)} USDC into the treasury executor...`)
        const topUpHash = await writeContractAsync({
          abi: treasuryExecutorContractAbi,
          address: activeExecutorAddress as Address,
          chainId: arcTestnet.id,
          functionName: 'executeTopUp',
          args: [amountUnits],
        })

        await publicClient.waitForTransactionReceipt({ hash: topUpHash })

        pushActivity({
          title: 'Stablecoin top-up executed',
          detail: `TreasuryExecutor received ${formatUsdc(stablecoinExecutionAmount)} USDC. Tx ${formatTx(topUpHash)}.`,
          tone: 'success',
        })
        setStablecoinExecutionMessage(
          `Top-up confirmed. ${formatUsdc(stablecoinExecutionAmount)} USDC moved into the treasury executor.`,
        )
      } else {
        setStablecoinExecutionMessage(`Withdrawing ${formatUsdc(stablecoinExecutionAmount)} USDC from the treasury executor...`)
        const trimHash = await writeContractAsync({
          abi: treasuryExecutorContractAbi,
          address: activeExecutorAddress as Address,
          chainId: arcTestnet.id,
          functionName: 'executeTrim',
          args: [(activeWalletAddress ?? activeExecutorAddress) as Address, amountUnits],
        })

        await publicClient.waitForTransactionReceipt({ hash: trimHash })

        pushActivity({
          title: 'Stablecoin trim executed',
          detail: `TreasuryExecutor sent ${formatUsdc(stablecoinExecutionAmount)} USDC back to the live operator wallet. Tx ${formatTx(trimHash)}.`,
          tone: 'success',
        })
        setStablecoinExecutionMessage(
          `Trim confirmed. ${formatUsdc(stablecoinExecutionAmount)} USDC moved back to the live operator wallet.`,
        )
      }

      await treasuryBalanceQuery.refetch()
      await latestPolicyEventQuery.refetch()
      const nextTreasuryBalance =
        stablecoinExecutionAction === 'top_up'
          ? stablecoinBalance + stablecoinExecutionAmount
          : Math.max(0, stablecoinBalance - stablecoinExecutionAmount)
      setStablecoinTestMessage(
        `EXECUTED | ${stablecoinExecutionAction.toUpperCase()} confirmed. Treasury ${formatUsdc(nextTreasuryBalance)} USDC.`,
      )
      return true
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setStablecoinExecutionMessage(`Execution failed: ${message}`)
      pushActivity({
        title: 'Stablecoin execution failed',
        detail: message,
        tone: 'warning',
      })
      return false
    } finally {
      setSubmissionInFlight(false)
    }
  }

  async function deployExecutorForWallet(activeWalletAddress: Address): Promise<Address | null> {
    if (!ownerAddress || activeWalletAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
      setExecutorDeployMessage('Only the live operator wallet should deploy TreasuryExecutor.')
      return null
    }

    if (!publicClient || !walletClient) {
      setExecutorDeployMessage('Wallet or public client unavailable.')
      return null
    }

    if (executorAddress) {
      setExecutorDeployMessage(`TreasuryExecutor already configured at ${truncateAddress(executorAddress)}.`)
      return executorAddress as Address
    }

    try {
      setExecutorDeploymentInFlight(true)
      setExecutorDeployMessage('Submitting TreasuryExecutor deployment transaction...')

      const txHash = await walletClient.deployContract({
        abi: treasuryExecutorContractAbi,
        bytecode: treasuryExecutorContractBytecode,
        chain: arcTestnet,
        account: activeWalletAddress,
        args: [arcUsdcAddress],
      })

      const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
      const deployedAddress = receipt.contractAddress
      if (!deployedAddress) {
        throw new Error('Deployment transaction did not return a contract address.')
      }

      setLocalExecutorAddress(deployedAddress)
      setExecutorDeployMessage(`TreasuryExecutor deployed at ${deployedAddress}. Execution is now enabled in this browser.`)
      pushActivity({
        title: 'TreasuryExecutor deployed',
        detail: `Contract deployed to ${truncateAddress(deployedAddress)} from the live operator wallet.`,
        tone: 'success',
      })
      await treasuryBalanceQuery.refetch()
      return deployedAddress
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setExecutorDeployMessage(`TreasuryExecutor deployment failed: ${message}`)
      pushActivity({
        title: 'TreasuryExecutor deployment failed',
        detail: message,
        tone: 'warning',
      })
      return null
    } finally {
      setExecutorDeploymentInFlight(false)
    }
  }

  async function handleDeployExecutor(): Promise<Address | null> {
    const demoExecutorAddress = '0x00000000000000000000000000000000deadbeef' as Address

    if (!liveOperatorAvailable) {
      setExecutorDeployMessage(
        `Public demo mode: TreasuryExecutor is simulated at ${truncateAddress(demoExecutorAddress)}.`,
      )
      setLocalExecutorAddress(demoExecutorAddress)
      pushActivity({
        title: 'TreasuryExecutor simulated',
        detail: `Public demo mode staged executor ${truncateAddress(demoExecutorAddress)} locally.`,
        tone: 'success',
      })
      return demoExecutorAddress
    }

    let activeWalletAddress = address ?? null

    if (!isConnected) {
      setExecutorDeployMessage('Connect the live operator wallet before deploying TreasuryExecutor.')
      activeWalletAddress = await handleConnect()
      if (!activeWalletAddress) {
        return null
      }
    }

    if (!walletOnArc) {
      setExecutorDeployMessage('Switch the wallet to Arc Testnet before deploying TreasuryExecutor.')
      const switched = await handleSwitchChain()
      if (!switched) {
        return null
      }
    }

    if (!activeWalletAddress) {
      return null
    }

    return deployExecutorForWallet(activeWalletAddress)
  }

  async function handleRefreshCircleStatus() {
    try {
      await circleStatusQuery.refetch()
      setCircleStatusMessage('Circle control plane refreshed from the live API.')
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Circle refresh error.'
      setCircleStatusMessage(`Circle control plane refresh failed: ${message}`)
    }
  }

  async function handleCreateCircleWallet() {
    try {
      setCircleWalletCreationInFlight(true)
      if (!liveOperatorAvailable) {
        const demoWalletSetId = `demo-circle-wallet-set-${Date.now().toString(36)}`
        setLocalCircleWalletSetId(demoWalletSetId)
        setCircleCreateMessage(
          `Public demo mode: Circle wallet set ${demoWalletSetId} is simulated locally for this browser session.`,
        )
        pushActivity({
          title: 'Circle wallet simulated',
          detail: 'Public demo mode staged a local Circle wallet set for the dashboard preview.',
          tone: 'success',
        })
        void circleStatusQuery.refetch().catch(() => undefined)
        return
      }

      setCircleCreateMessage('Submitting Circle wallet creation request...')

      const response = await fetch('/api/circle/wallets', {
        body: JSON.stringify({
          accountType: 'EOA',
          blockchain: 'ARC-TESTNET',
          walletName: 'Arc Treasury Operator',
          walletSetId: circleWalletSetId,
          walletSetName: 'Arc Treasury Control Plane',
        }),
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
        },
        method: 'POST',
      })

      const payload = (await response.json().catch(() => ({}))) as {
        error?: string
        missing?: string[]
        walletSetId?: string
        wallets?: Array<{ address?: string; blockchain?: string; id?: string }>
      }

      if (!response.ok) {
        const missing = payload.missing?.length ? ` Missing: ${payload.missing.join(', ')}.` : ''
        throw new Error(`${payload.error ?? `Circle wallet creation failed with ${response.status}.`}${missing}`)
      }

      if (payload.walletSetId) {
        setLocalCircleWalletSetId(payload.walletSetId)
      }

      const walletLabel = payload.wallets?.[0]?.address ? truncateAddress(payload.wallets[0].address) : 'created'
      setCircleCreateMessage(
        `Circle wallet ${walletLabel} is ready${payload.walletSetId ? ` in wallet set ${truncateAddress(payload.walletSetId, 8, 6)}` : ''}.`,
      )
      pushActivity({
        title: 'Circle developer wallet created',
        detail: payload.walletSetId
          ? `Wallet set ${truncateAddress(payload.walletSetId, 8, 6)} created or reused and a dev-controlled wallet was provisioned.`
          : 'Developer-controlled wallet created through the Circle API.',
        tone: 'success',
      })
      await circleStatusQuery.refetch()
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Circle wallet creation error.'
      setCircleCreateMessage(`Circle wallet creation failed: ${message}`)
      pushActivity({
        title: 'Circle developer wallet failed',
        detail: message,
        tone: 'warning',
      })
    } finally {
      setCircleWalletCreationInFlight(false)
    }
  }

  async function handleWakeArcAgent(options?: { runBrief?: boolean }): Promise<ArcAgentActivationResult | null> {
    try {
      setArcAgentWakeInFlight(true)
      setArcAgentWakeMessage('Submitting a fresh reputation and validation round from the dashboard...')

      const response = await fetch('/api/arc-agent/activate', {
        cache: 'no-store',
        method: 'POST',
      })

      const payload = (await response.json().catch(() => ({}))) as Partial<ArcAgentActivationResult> & {
        error?: string
      }

      if (!response.ok) {
        throw new Error(payload.error ?? `Arc agent activation failed with ${response.status}.`)
      }

      if (!payload.requestHash || !payload.validationStatus) {
        throw new Error('Arc agent activation did not return the expected onchain state.')
      }

      const activation = payload as ArcAgentActivationResult
      setLastArcAgentActivation(activation)
      setLocalArcAgentValidationRequestHash(activation.requestHash)
      setArcAgentWakeMessage(
        `Agent activated. Validation ${activation.validationStatus.response} · ${activation.validationStatus.tag} · block ${activation.validationStatus.lastUpdate}.`,
      )
      pushActivity({
        title: 'Arc agent activated',
        detail: `Reputation tx ${formatTx(activation.txHashes.reputation)} and validation tx ${formatTx(
          activation.txHashes.validationResponse,
        )} submitted for agent ${activation.agentId}.`,
        tone: 'success',
      })
      await Promise.all([arcAgentOwnerQuery.refetch(), arcAgentTokenUriQuery.refetch()])
      if (options?.runBrief !== false) {
        await handleRunArcAgentBrief(activation.requestHash)
      }
      return activation
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Arc agent activation error.'
      setArcAgentWakeMessage(`Activation failed: ${message}`)
      pushActivity({
        title: 'Arc agent activation failed',
        detail: message,
        tone: 'warning',
      })
      return null
    } finally {
      setArcAgentWakeInFlight(false)
    }
  }

  async function handleRunArcAgentBrief(requestHash?: `0x${string}`) {
    try {
      setArcAgentBriefInFlight(true)
      setArcAgentBriefMessage('Loading a live operational brief from Arc Testnet...')

      const params = new URLSearchParams()
      const activeRequestHash = requestHash ?? activeArcAgentValidationRequestHash

      if (activeRequestHash) {
        params.set('requestHash', activeRequestHash)
      }

      const response = await fetch(`/api/arc-agent/brief${params.toString() ? `?${params.toString()}` : ''}`, {
        cache: 'no-store',
      })

      const payload = (await response.json().catch(() => ({}))) as Partial<ArcAgentBriefResult> & {
        error?: string
      }

      if (!response.ok) {
        throw new Error(payload.error ?? `Arc agent brief request failed with ${response.status}.`)
      }

      if (!payload.recommendation || !payload.validationStatus) {
        throw new Error('Arc agent brief did not return the expected operational state.')
      }

      const brief = payload as ArcAgentBriefResult
      setLastArcAgentBrief(brief)
      setArcAgentBriefMessage(
        `${formatArcAgentRecommendationAction(brief.recommendation.action)} · ${brief.recommendation.headline}`,
      )
      pushActivity({
        title: 'Arc agent brief ready',
        detail: `${brief.recommendation.headline} ${brief.recommendation.detail}`,
        tone: brief.recommendation.action === 'hold' ? 'success' : 'warning',
      })
      return brief
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown Arc agent brief error.'
      setArcAgentBriefMessage(`Brief failed: ${message}`)
      pushActivity({
        title: 'Arc agent brief failed',
        detail: message,
        tone: 'warning',
      })
      return null
    } finally {
      setArcAgentBriefInFlight(false)
    }
  }

  async function handleActOnArcAgentBrief(briefOverride?: ArcAgentBriefResult | null): Promise<boolean> {
    const activeBrief = briefOverride ?? lastArcAgentBrief
    const recommendation = activeBrief?.recommendation.action

    if (!recommendation) {
      setArcAgentBriefMessage('Run a brief first so the dashboard can determine the next action.')
      return false
    }

    if (!liveOperatorAvailable) {
      return handleActOnArcAgentBriefInDemo(activeBrief)
    }

    if (recommendation === 'hold') {
      setArcAgentBriefMessage('The agent recommends holding. The site is already inside the policy band.')
      pushActivity({
        title: 'Arc agent brief held',
        detail: 'No execution was needed after the takeover cycle.',
        tone: 'success',
      })
      return true
    }

    if (recommendation === 'deploy_executor') {
      const deployedAddress = await handleDeployExecutor()
      if (deployedAddress) {
        await handleRunArcAgentBrief(activeBrief?.requestHash)
        return true
      }
      return false
    }

    if (recommendation === 'top_up' || recommendation === 'trim') {
      const executed = await handleExecuteStablecoinPolicy()
      if (executed) {
        await handleRunArcAgentBrief(activeBrief?.requestHash)
        return true
      }
      return false
    }

    if (recommendation === 'create_circle_wallet') {
      await handleCreateCircleWallet()
      await handleRunArcAgentBrief(activeBrief?.requestHash)
      return true
    }

    if (recommendation === 'load_policy') {
      await handleRefreshChainPolicy()
      await handleRunArcAgentBrief(activeBrief?.requestHash)
      return true
    }

    if (recommendation === 'configure_circle') {
      await handleRefreshCircleStatus()
      await handleRunArcAgentBrief(activeBrief?.requestHash)
      return true
    }

    setArcAgentBriefMessage(`Recommendation ${recommendation} is not mapped to an executable action yet.`)
    return false
  }

  async function handleActOnArcAgentBriefInDemo(brief: ArcAgentBriefResult): Promise<boolean> {
    const recommendation = brief.recommendation.action

    if (recommendation === 'hold') {
      setArcAgentBriefMessage('Public demo mode: the agent recommends holding, and the preview stays in band.')
      pushActivity({
        title: 'Arc agent brief held',
        detail: 'Public demo mode did not need to move any funds.',
        tone: 'success',
      })
      return true
    }

    if (recommendation === 'deploy_executor') {
      const deployedAddress = await handleDeployExecutor()
      if (deployedAddress) {
        await handleRunArcAgentBrief(brief.requestHash)
        return true
      }
      return false
    }

    if (recommendation === 'top_up' || recommendation === 'trim') {
      const nextTreasuryBalance =
        recommendation === 'top_up'
          ? treasuryBalance + stablecoinExecutionAmount
          : Math.max(0, treasuryBalance - stablecoinExecutionAmount)
      setDemoTreasuryBalance(nextTreasuryBalance)
      setStablecoinExecutionMessage(
        `Public demo mode: ${formatArcAgentRecommendationAction(recommendation)} simulated locally.`,
      )
      pushActivity({
        title: recommendation === 'top_up' ? 'Stablecoin top-up simulated' : 'Stablecoin trim simulated',
        detail: `Public demo mode adjusted the treasury preview by ${formatUsdc(stablecoinExecutionAmount)} USDC.`,
        tone: 'success',
      })
      setStablecoinTestMessage(
        `DEMO | ${recommendation.toUpperCase()} simulated. Treasury ${formatUsdc(nextTreasuryBalance)} USDC.`,
      )
      await handleRunArcAgentBrief(brief.requestHash)
      return true
    }

    if (recommendation === 'create_circle_wallet') {
      await handleCreateCircleWallet()
      await handleRunArcAgentBrief(brief.requestHash)
      return true
    }

    if (recommendation === 'load_policy') {
      setDemoPolicy(chainPolicy ?? draftPolicy)
      await handleRefreshChainPolicy()
      await handleRunArcAgentBrief(brief.requestHash)
      return true
    }

    if (recommendation === 'configure_circle') {
      await handleRefreshCircleStatus()
      await handleRunArcAgentBrief(brief.requestHash)
      return true
    }

    setArcAgentBriefMessage(`Public demo mode: recommendation ${recommendation} is not mapped yet.`)
    return false
  }

  async function handleRunAgentTakeover() {
    if (agentTakeoverInFlight) {
      return
    }

    const startedAt = new Date().toISOString()
    setAgentTakeoverInFlight(true)
    setLastAgentTakeoverAt(startedAt)
    setAgentTakeoverMessage('Preparing the site for takeover...')
    pushActivity({
      title: 'Agent takeover started',
      detail: publicDemoMode
        ? 'Refreshing policy, Circle, and agent state from the public demo control loop.'
        : 'Refreshing wallet, policy, Circle, and agent state from one control loop.',
      tone: 'neutral',
    })

    try {
      if (liveOperatorAvailable) {
        if (!walletOnArc) {
          setAgentTakeoverMessage('Switching the wallet to Arc Testnet...')
          const switched = await handleSwitchChain()
          if (!switched) {
            setAgentTakeoverMessage('Takeover blocked: switch the wallet to Arc Testnet first.')
            return
          }
        }
      } else {
        setAgentTakeoverMessage('Public demo mode: running the takeover cycle without a live wallet.')
      }

      setAgentTakeoverMessage('Refreshing Circle status and policy band...')
      await handleRefreshCircleStatus()
      if (contractAddress) {
        await handleRefreshChainPolicy()
      }

      setAgentTakeoverMessage('Waking the Arc agent...')
      const activation = await handleWakeArcAgent({ runBrief: false })
      if (!activation) {
        setAgentTakeoverMessage('Takeover blocked: agent activation failed.')
        return
      }

      setAgentTakeoverMessage('Loading a live brief...')
      const brief = await handleRunArcAgentBrief(activation.requestHash)
      if (!brief) {
        setAgentTakeoverMessage('Takeover blocked: agent brief failed.')
        return
      }

      setAgentTakeoverMessage(`Acting on ${formatArcAgentRecommendationAction(brief.recommendation.action)}...`)
      const executed = await handleActOnArcAgentBrief(brief)
      if (!executed) {
        setAgentTakeoverMessage(`Takeover paused: ${brief.recommendation.headline}`)
        return
      }

      setAgentTakeoverMessage(
        `Takeover complete: ${formatArcAgentRecommendationAction(brief.recommendation.action)} handled and the dashboard refreshed.`,
      )
      pushActivity({
        title: 'Agent takeover complete',
        detail: `${formatArcAgentRecommendationAction(brief.recommendation.action)} · ${brief.recommendation.headline}`,
        tone: 'success',
      })
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown takeover error.'
      setAgentTakeoverMessage(`Takeover failed: ${message}`)
      pushActivity({
        title: 'Agent takeover failed',
        detail: message,
        tone: 'warning',
      })
    } finally {
      setAgentTakeoverInFlight(false)
    }
  }

  const currentStatus = evaluation?.status ?? (publicDemoMode ? 'healthy' : null)
  const usingDemoPolicy = demoPolicy !== null
  const policySyncBadge =
    usingDemoPolicy
      ? 'Synced in demo'
      : chainPolicy && policiesEqual(draftPolicy, chainPolicy)
        ? 'Synced with chain'
        : chainPolicy
          ? 'Draft differs'
          : 'Draft only'
  const policySyncVariant = usingDemoPolicy
    ? 'outline'
    : chainPolicy
      ? (policiesEqual(draftPolicy, chainPolicy) ? 'success' : 'warning')
      : 'outline'
  const policyCardTitle = usingDemoPolicy
    ? 'Demo policy preview'
    : chainPolicy
      ? 'Current policy from chain'
      : 'Current policy unavailable'
  const policyCardDescription =
    usingDemoPolicy
      ? 'Public demo mode is showing a local preview of the policy band.'
      : treasuryPolicyAddressConfig.status === 'configured'
        ? 'Read the deployed TreasuryPolicy contract on Arc Testnet.'
        : 'Set TREASURY_POLICY_ADDRESS to read the deployed TreasuryPolicy contract.'
  const contractAddressLabel =
    treasuryPolicyAddressConfig.status === 'configured'
      ? truncateAddress(contractAddress ?? '')
      : treasuryPolicyAddressConfig.status === 'invalid'
        ? 'Invalid contract address'
        : 'Contract address missing'
  const ownerLabel = ownerAddress ? truncateAddress(ownerAddress) : 'Loading owner'
  const latestEvent = latestPolicyEventQuery.data
  const latestEventLabel = latestEvent ? `Block ${latestEvent.blockNumber?.toString() ?? 'unknown'}` : 'No update event yet'
  const circleControlPlane = circleStatusQuery.data
  const circleReadiness = circleControlPlane?.readiness
  const circleLiveWallets = circleControlPlane?.wallets ?? []
  const circleGatewayInfo = circleControlPlane?.gatewayInfo
  const circleGatewayBalances = circleControlPlane?.gatewayBalances
  const circleLiveWalletSetId = circleControlPlane?.config?.walletSetId ?? circleWalletSetId
  const circleGatewayDomainCount = circleGatewayInfo?.domains?.length ?? 0
  const circleApiReady = Boolean(circleReadiness?.apiKeyConfigured && circleReadiness?.entitySecretConfigured)
  const circleWalletReady = Boolean(circleLiveWalletSetId && circleLiveWallets.length > 0)
  const circleGatewayReady = Boolean(circleGatewayInfo?.version)
  const circleGatewayBalanceLabel = circleGatewayBalances?.balances?.[0]?.balance
    ? `${circleGatewayBalances.balances[0].balance} USDC`
    : 'No Gateway balance returned yet'
  const agentTakeoverReady = Boolean(contractAddress && circleApiReady && currentPolicy)
  const agentTakeoverStatusLabel = !contractAddress
    ? 'Policy missing'
    : !circleApiReady
      ? 'Circle incomplete'
      : publicDemoMode
        ? 'Public demo ready'
        : 'Ready to take over'

  return (
    <main className="min-h-screen pb-16">
      <SiteHeader
        eyebrow="Treasury dashboard"
        title="Arc USDC Rebalancer"
        description="Explore the policy, run sample treasury scenarios, and switch to live operator mode only when you want signed Arc Testnet actions."
        ctaHref="/"
        ctaLabel="Back to landing"
      />

      <div className="sticky top-4 z-20">
        <div className="mx-auto w-full max-w-screen-2xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-3xl border border-white/10 bg-background/90 p-4 shadow-[0_20px_60px_-32px_rgba(15,23,42,0.85)] backdrop-blur">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Quick actions</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Visitors can start in public demo mode. Connect a wallet only if you want live signing.
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant={publicDemoMode ? 'success' : 'outline'}>{publicDemoMode ? 'Public demo' : 'Wallet ready'}</Badge>
              <Badge variant={walletOnArc || publicDemoMode ? 'success' : 'warning'}>
                {walletOnArc ? 'Arc Testnet' : publicDemoMode ? 'Wallet optional' : 'Switch needed'}
              </Badge>
              <Badge variant={executorAddress ? 'success' : 'warning'}>
                {executorAddress ? 'Executor ready' : publicDemoMode ? 'Demo executor' : 'Executor missing'}
              </Badge>
              <Badge variant={stablecoinRobotExecutionReady || publicDemoMode ? 'success' : 'warning'}>
                {stablecoinRobotExecutionReady
                  ? 'Execution ready'
                  : publicDemoMode
                    ? 'Demo execution ready'
                    : 'Execution blocked'}
              </Badge>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            <Button
              type="button"
              className="w-full"
              onClick={() => void handleRunAgentTakeover()}
              disabled={agentTakeoverInFlight}
            >
              <Bot className="h-4 w-4" />
              {agentTakeoverInFlight ? 'Taking over…' : publicDemoMode ? 'Run public demo' : 'Run takeover cycle'}
            </Button>
            {!isConnected ? (
              <Button type="button" className="w-full" onClick={() => void handleConnect()} disabled={isConnecting}>
                <Wallet className="h-4 w-4" />
                {isConnecting ? 'Connecting…' : 'Connect live wallet'}
              </Button>
            ) : (
              <Button type="button" className="w-full" variant="secondary" onClick={handleDisconnect}>
                Disconnect
              </Button>
            )}
            <Button
              type="button"
              className="w-full"
              variant="outline"
              onClick={() => void handleSwitchChain()}
              disabled={!isConnected || isSwitching}
            >
              <RefreshCcw className="h-4 w-4" />
              {isSwitching ? 'Switching…' : 'Switch to Arc Testnet'}
            </Button>
            {!executorAddress ? (
              <Button
                type="button"
                className="w-full"
                variant="secondary"
                onClick={() => void handleDeployExecutor()}
                disabled={executorDeploymentInFlight}
              >
                <FileText className="h-4 w-4" />
                {executorDeploymentInFlight ? 'Deploying…' : 'Deploy executor'}
              </Button>
            ) : (
              <Button
                type="button"
                className="w-full"
                variant="secondary"
                onClick={() => void handleDeployExecutor()}
                disabled={executorDeploymentInFlight}
              >
                <FileText className="h-4 w-4" />
                {executorDeploymentInFlight ? 'Deploying…' : 'Recheck executor'}
              </Button>
            )}
          </div>
        </div>
      </div>
      </div>

      <section className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-4 pb-8 pt-8 sm:px-6 lg:px-8">
        <div className="grid gap-4 lg:grid-cols-12">
          <Card className="border-primary/20 bg-primary/5 lg:col-span-12">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardDescription>Agent takeover</CardDescription>
                <CardTitle className="mt-1 text-lg">
                  One control loop for public demo or live operator mode
                </CardTitle>
              </div>
              <Bot className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={agentTakeoverReady ? 'success' : 'warning'}>{agentTakeoverStatusLabel}</Badge>
                <Badge variant="outline">
                  {lastAgentTakeoverAt ? `Last run ${formatTimestamp(lastAgentTakeoverAt)}` : 'No takeover run yet'}
                </Badge>
                <Badge variant={circleApiReady ? 'success' : 'warning'}>
                  {circleApiReady ? 'Circle ready' : 'Circle incomplete'}
                </Badge>
                <Badge variant={executorAddress ? 'success' : 'warning'}>
                  {executorAddress ? 'Executor ready' : 'Executor missing'}
                </Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Wallet</div>
                  <div className="mt-2 text-foreground">
                    {isConnected
                      ? truncateAddress(address ?? '')
                      : 'Public demo ready. Connect a wallet only for live signing.'}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Network</div>
                  <div className="mt-2 text-foreground">{walletOnArc || publicDemoMode ? 'Arc Testnet' : 'Switch required'}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Policy</div>
                  <div className="mt-2 text-foreground">{contractAddress ? 'Loaded' : 'Missing'}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Circle</div>
                  <div className="mt-2 text-foreground">{circleApiReady || publicDemoMode ? 'Ready' : 'Incomplete'}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Executor</div>
                  <div className="mt-2 text-foreground">{executorAddress || publicDemoMode ? 'Live or demo ready' : 'Deploy or simulate'}</div>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm text-muted-foreground">
                {agentTakeoverMessage}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={() => void handleRunAgentTakeover()}
                  disabled={agentTakeoverInFlight}
                >
                  <Bot className="h-4 w-4" />
                  {agentTakeoverInFlight ? 'Taking over…' : publicDemoMode ? 'Run public demo' : 'Run takeover cycle'}
                </Button>
                <Button type="button" variant="outline" onClick={() => void handleWakeArcAgent()} disabled={arcAgentWakeInFlight}>
                  <RefreshCcw className="h-4 w-4" />
                  {arcAgentWakeInFlight ? 'Waking…' : 'Wake agent'}
                </Button>
                <Button type="button" variant="outline" onClick={() => void handleRunArcAgentBrief()} disabled={arcAgentBriefInFlight}>
                  <FileText className="h-4 w-4" />
                  {arcAgentBriefInFlight ? 'Briefing…' : 'Run brief'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleActOnArcAgentBrief()}
                  disabled={arcAgentBriefInFlight || arcAgentWakeInFlight}
                >
                  <Send className="h-4 w-4" />
                  {lastArcAgentBrief
                    ? `Run ${formatArcAgentRecommendationAction(lastArcAgentBrief.recommendation.action)}`
                    : 'Act on brief'}
                </Button>
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-12 border-primary/20 bg-primary/5">
            <CardHeader className="space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">
                  Public demo first
                </Badge>
                <Badge variant="outline">Builder evidence</Badge>
              </div>
              <CardTitle className="text-lg">Start with the demo path</CardTitle>
              <CardDescription>
                Visitors should begin in public demo mode, then inspect the brief and evidence before they ever touch
                live signing.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 md:grid-cols-3">
                {publicLaunchPath.map((item) => (
                  <div key={item.step} className="rounded-3xl border border-white/10 bg-background/50 p-5">
                    <div className="flex items-center justify-between gap-4">
                      <span className="font-display text-3xl font-semibold tracking-tight text-primary">{item.step}</span>
                      <div className="h-px flex-1 bg-gradient-to-r from-primary/40 to-transparent" />
                    </div>
                    <div className="mt-4 font-display text-xl font-semibold tracking-tight text-foreground">
                      {item.title}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => loadPublicDemoScenario(publicDemoPreviewBalance, 'Default public demo')}
                >
                  Default demo
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    loadPublicDemoScenario(Math.max(0, currentPolicy.minThreshold - 25), 'Below-minimum scenario')
                  }
                >
                  Below minimum
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => loadPublicDemoScenario(currentPolicy.targetBalance, 'At-target scenario')}
                >
                  At target
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    loadPublicDemoScenario(
                      currentPolicy.targetBalance + currentPolicy.maxRebalanceAmount,
                      'Above-target scenario',
                    )
                  }
                >
                  Above target
                </Button>
              </div>

              <div className="grid gap-3 md:grid-cols-3">
                {builderReferenceLinks.map((link) => (
                  <a
                    key={link.label}
                    className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{link.label}</div>
                    <div className="mt-2 break-all text-sm text-foreground">{link.value}</div>
                    <div className="mt-2 inline-flex items-center gap-1 text-xs text-primary">
                      Open
                      <ExternalLink className="h-3.5 w-3.5" />
                    </div>
                  </a>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-4">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardDescription>{publicDemoMode ? 'Visitor access' : 'Connected wallet'}</CardDescription>
                <CardTitle className="mt-1 text-lg">{walletSummary}</CardTitle>
              </div>
              <Wallet className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={isConnected ? 'success' : 'outline'}>{isConnected ? 'Connected' : 'Disconnected'}</Badge>
                <Badge variant={walletOnArc ? 'success' : 'warning'}>
                  {isConnected ? (walletOnArc ? 'Arc Testnet' : 'Switch needed') : 'No wallet'}
                </Badge>
                <Badge variant={connectedWalletIsOwner ? 'success' : ownerAddress ? 'warning' : 'outline'}>
                  {ownerAddress ? (connectedWalletIsOwner ? 'Live operator' : 'Public demo') : 'Operator loading'}
                </Badge>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Wallet balance</div>
                <div className="mt-2 text-foreground">
                  {walletBalanceQuery.data ? `${formatUsdc(Number(walletBalanceQuery.data.formatted ?? 0))} USDC` : 'Public demo mode'}
                </div>
              </div>
              <div>{isConnected ? `Active account ${address}` : 'No wallet is required to explore the public demo.'}</div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-4">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardDescription>{policyCardTitle}</CardDescription>
                <CardTitle className="mt-1 text-lg">{policySyncBadge}</CardTitle>
              </div>
              <FileText className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Min</div>
                  <div className="mt-2 text-foreground">
                    {chainPolicy ? `${formatUsdc(chainPolicy.minThreshold)} USDC` : '—'}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Target</div>
                  <div className="mt-2 text-foreground">
                    {chainPolicy ? `${formatUsdc(chainPolicy.targetBalance)} USDC` : '—'}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Max</div>
                  <div className="mt-2 text-foreground">
                    {chainPolicy ? `${formatUsdc(chainPolicy.maxRebalanceAmount)} USDC` : '—'}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
                <Badge variant={policySyncVariant}>{policySyncBadge}</Badge>
                <span>Contract {contractAddressLabel}</span>
                    <span>Onchain owner {ownerLabel}</span>
              </div>
              <div className="text-sm text-muted-foreground">{policyCardDescription}</div>
            </CardContent>
          </Card>

          <Card className="lg:col-span-4">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardDescription>Latest PolicyUpdated event</CardDescription>
                <CardTitle className="mt-1 text-lg">{latestEventLabel}</CardTitle>
              </div>
              <Activity className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              {latestEvent ? (
                <>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="success">Latest</Badge>
                    <Badge variant="outline">Onchain owner {truncateAddress(latestEvent.args.owner)}</Badge>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Min</div>
                      <div className="mt-2 text-foreground">
                        {formatUsdc(formatTreasuryPolicyAmount(latestEvent.args.minThreshold))} USDC
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Target</div>
                      <div className="mt-2 text-foreground">
                        {formatUsdc(formatTreasuryPolicyAmount(latestEvent.args.targetBalance))} USDC
                      </div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Max</div>
                      <div className="mt-2 text-foreground">
                        {formatUsdc(formatTreasuryPolicyAmount(latestEvent.args.maxRebalanceAmount))} USDC
                      </div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Transaction</div>
                    <div className="mt-2 break-all text-foreground">{formatTx(latestEvent.transactionHash)}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      Block {latestEvent.blockNumber?.toString() ?? 'unknown'}
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-white/10 bg-background/40 p-4 text-sm text-muted-foreground">
                  No `PolicyUpdated` event has been observed yet. The latest event will appear after the first live
                  operator update on Arc Testnet.
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-12">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardDescription>Simulated rebalance status</CardDescription>
                <CardTitle className="mt-1 text-lg">
                  {currentStatus ? currentStatus.replace('_', ' ') : 'Public demo mode'}
                </CardTitle>
              </div>
              <ArrowRightLeft className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Balance</div>
                  <div className="mt-2 text-foreground">
                    {isConnected
                      ? `${formatUsdc(Number(treasuryBalanceQuery.data?.formatted ?? 0))} USDC`
                      : 'Public demo preview'}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Action</div>
                  <div className="mt-2 text-foreground">{evaluation?.action ?? 'hold'}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Amount</div>
                  <div className="mt-2 text-foreground">{evaluation ? `${formatUsdc(evaluation.amount)} USDC` : '--'}</div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={evaluation?.status === 'healthy' ? 'success' : 'warning'}>
                  {evaluation?.status ?? (publicDemoMode ? 'Public demo' : 'Awaiting wallet')}
                </Badge>
                {evaluation?.reasonCodes.map((reasonCode) => (
                  <Badge key={reasonCode} variant="outline">
                    {reasonCode}
                  </Badge>
                ))}
              </div>
              {publicDemoMode ? (
                <div className="flex flex-wrap items-center gap-2">
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => loadPublicDemoScenario(publicDemoPreviewBalance, 'Default public demo')}
                  >
                    Default demo
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      loadPublicDemoScenario(Math.max(0, currentPolicy.minThreshold - 25), 'Below-minimum scenario')
                    }
                  >
                    Below minimum
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => loadPublicDemoScenario(currentPolicy.targetBalance, 'At-target scenario')}
                  >
                    At target
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      loadPublicDemoScenario(
                        currentPolicy.targetBalance + currentPolicy.maxRebalanceAmount,
                        'Above-target scenario',
                      )
                    }
                  >
                    Above target
                  </Button>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={() => void handleSimulateRebalance()}>
                  <ArrowRightLeft className="h-4 w-4" />
                  Simulate rebalance
                </Button>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm text-muted-foreground">
                {simulationMessage}
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/20 bg-primary/5 lg:col-span-12">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardDescription>Stablecoin robot test</CardDescription>
                <CardTitle className="mt-1 text-lg">{stablecoinRobotStatus.toUpperCase()}</CardTitle>
              </div>
              <Wallet className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={robotStatusVariant(stablecoinRobotStatus)}>
                  {stablecoinRobotStatus === 'pass'
                    ? 'PASS'
                    : stablecoinRobotStatus === 'warn'
                      ? 'WARN'
                      : 'WAIT'}
                </Badge>
                <Badge variant="outline">{`Confidence ${stablecoinRobotConfidence.toFixed(2)}`}</Badge>
                <Badge variant="outline">{`Risk ${stablecoinRobotStatus === 'pass' ? 'LOW' : stablecoinRobotStatus === 'warn' ? 'MEDIUM' : 'HIGH'}`}</Badge>
                <Badge variant={stablecoinRobotExecutionReady ? 'success' : 'warning'}>
                  {stablecoinRobotExecutionReady ? 'Execution ready' : 'Execution blocked'}
                </Badge>
                <Badge variant="outline">
                  {executorAddress ? `Executor ${truncateAddress(executorAddress)}` : 'Executor missing'}
                </Badge>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Treasury balance</div>
                  <div className="mt-2 text-foreground">{formatUsdc(stablecoinBalance)} USDC</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Execution amount</div>
                  <div className="mt-2 text-foreground">{`${formatUsdc(stablecoinExecutionAmount)} USDC`}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Target</div>
                  <div className="mt-2 text-foreground">
                    {currentPolicy ? `${formatUsdc(currentPolicy.targetBalance)} USDC` : '—'}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Band</div>
                  <div className="mt-2 text-foreground">
                    {currentPolicy
                      ? `${formatUsdc(currentPolicy.minThreshold)} / ${formatUsdc(currentPolicy.targetBalance)} / ${formatUsdc(currentPolicy.maxRebalanceAmount)}`
                      : '—'}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {stablecoinRobotReasonCodes.map((reasonCode) => (
                  <Badge key={reasonCode} variant="outline">
                    {reasonCode}
                  </Badge>
                ))}
              </div>
              <div className="grid gap-2">
                {stablecoinRobotChecks.map((check) => (
                  <div key={check.label} className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-background/50 p-3">
                    <div>
                      <div className="font-medium text-foreground">{check.label}</div>
                      <div className="text-xs text-muted-foreground">{check.detail}</div>
                    </div>
                    <Badge variant={check.passed ? 'success' : 'warning'}>{check.passed ? 'OK' : 'Check'}</Badge>
                  </div>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={handleRunStablecoinTest}>
                  <RefreshCcw className="h-4 w-4" />
                  Run stablecoin test
                </Button>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm text-muted-foreground">
                {stablecoinTestMessage}
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm text-muted-foreground">
                {stablecoinExecutionMessage}
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm text-muted-foreground">
                {executorDeployMessage}
              </div>
            </CardContent>
          </Card>

          <Card className="border-cyan-500/20 bg-cyan-500/5 lg:col-span-12">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardDescription>Circle line</CardDescription>
                <CardTitle className="mt-1 text-lg">USDC, Arc, wallets, executor, and bridge</CardTitle>
              </div>
              <ArrowRightLeft className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={robotStatusVariant(circleStackStatus)}>{circleStackStatusLabel}</Badge>
                <Badge variant="outline">{circleWalletModeLabel(circleStackConfig.walletMode)}</Badge>
                <Badge variant="outline">{circleTransferModeLabel(circleStackConfig.transferMode)}</Badge>
                <Badge variant={walletOnArc ? 'success' : 'warning'}>
                  {walletOnArc ? 'Arc Testnet ready' : 'Arc switch needed'}
                </Badge>
                <Badge variant={executorAddress ? 'success' : 'warning'}>
                  {executorAddress ? 'Executor ready' : 'Executor missing'}
                </Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Wallet mode</div>
                  <div className="mt-2 text-foreground">{circleWalletModeLabel(circleStackConfig.walletMode)}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Bridge rail</div>
                  <div className="mt-2 text-foreground">{circleTransferModeLabel(circleStackConfig.transferMode)}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Source chain</div>
                  <div className="mt-2 text-foreground">{circleStackConfig.sourceChain}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Destination chain</div>
                  <div className="mt-2 text-foreground">{circleStackConfig.destinationChain}</div>
                </div>
              </div>
              <div className="grid gap-3 xl:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Operational path</div>
                  <div className="mt-2 text-foreground">{circleStackSummary()}</div>
                  <div className="mt-2 text-xs text-muted-foreground">
                    This surface maps the Circle-ready path for Arc USDC, wallets, executor deployment, and cross-chain
                    transfer planning.
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Readiness checks</div>
                  <div className="mt-3 grid gap-2">
                    {circleStackChecks.map((check) => (
                      <div
                        key={check.label}
                        className="flex items-start justify-between gap-3 rounded-2xl border border-white/10 bg-background/50 p-3"
                      >
                        <div>
                          <div className="font-medium text-foreground">{check.label}</div>
                          <div className="text-xs text-muted-foreground">{check.detail}</div>
                        </div>
                        <Badge variant={check.passed ? 'success' : 'warning'}>{check.passed ? 'OK' : 'Check'}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {circleSkillCatalog.map((skill) => (
                  <Badge key={skill.name} variant="outline" title={skill.description}>
                    {skill.name}
                  </Badge>
                ))}
              </div>
              <Separator />
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Live Circle APIs</div>
                    <div className="mt-1 text-foreground">
                      Create developer-controlled wallets and read live Gateway state from Circle’s testnet APIs.
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={circleApiReady ? 'success' : 'warning'}>
                      {circleApiReady ? 'API ready' : 'Missing secrets'}
                    </Badge>
                    <Badge variant={circleWalletReady ? 'success' : 'outline'}>
                      {circleWalletReady ? 'Wallets live' : 'No wallet yet'}
                    </Badge>
                    <Badge variant={circleGatewayReady ? 'success' : 'outline'}>
                      {circleGatewayReady ? 'Gateway online' : 'Gateway pending'}
                    </Badge>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 md:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Wallet set</div>
                    <div className="mt-2 text-foreground">
                      {circleLiveWalletSetId ? truncateAddress(circleLiveWalletSetId, 12, 8) : 'Create or configure a wallet set'}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {circleControlPlane?.walletSet?.custodyType
                        ? `Custody ${circleControlPlane.walletSet.custodyType}`
                        : 'Dev-controlled wallet set backed by Circle.'}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Gateway balance</div>
                    <div className="mt-2 text-foreground">{circleGatewayBalanceLabel}</div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      {circleGatewayDomainCount > 0
                        ? `${circleGatewayDomainCount} supported domains on Gateway v${circleGatewayInfo?.version ?? 'latest'}`
                        : 'Gateway info will appear once the API responds.'}
                    </div>
                  </div>
                </div>
                <div className="mt-4 grid gap-3 xl:grid-cols-2">
                  <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Created wallets</div>
                    <div className="mt-3 grid gap-2">
                      {circleLiveWallets.length > 0 ? (
                        circleLiveWallets.map((wallet, index) => (
                          <div
                            key={wallet.id ?? wallet.address ?? `wallet-${index}`}
                            className="rounded-2xl border border-white/10 bg-background/50 p-3"
                          >
                            <div className="font-medium text-foreground">
                              {wallet.name ?? wallet.address ?? 'Wallet'}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              {wallet.address ? truncateAddress(wallet.address, 10, 8) : 'Address pending'} ·{' '}
                              {wallet.blockchain ?? 'Unknown blockchain'}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-white/10 bg-background/40 p-4 text-sm text-muted-foreground">
                          No Circle wallets have been created in this wallet set yet.
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Gateway domains</div>
                    <div className="mt-3 grid gap-2">
                      {Array.isArray(circleGatewayInfo?.domains) && circleGatewayInfo.domains.length > 0 ? (
                        circleGatewayInfo.domains.slice(0, 4).map((domain, index) => (
                          <div
                            key={`${domain.domain}-${domain.network ?? 'network'}-${index}`}
                            className="rounded-2xl border border-white/10 bg-background/50 p-3"
                          >
                            <div className="font-medium text-foreground">
                              {domain.chain ?? 'Chain'} · {domain.network ?? 'Network'}
                            </div>
                            <div className="mt-1 text-xs text-muted-foreground">
                              Domain {domain.domain ?? '—'} · Wallet {domain.walletContract?.address ? truncateAddress(domain.walletContract.address, 8, 6) : '—'} · Minter {domain.minterContract?.address ? truncateAddress(domain.minterContract.address, 8, 6) : '—'}
                            </div>
                          </div>
                        ))
                      ) : (
                        <div className="rounded-2xl border border-dashed border-white/10 bg-background/40 p-4 text-sm text-muted-foreground">
                          Gateway domains will appear after the API responds.
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center gap-3">
                  <Button type="button" variant="outline" onClick={() => void handleRefreshCircleStatus()}>
                    <RefreshCcw className="h-4 w-4" />
                    {circleStatusQuery.isFetching ? 'Refreshing…' : 'Refresh Circle status'}
                  </Button>
                  <Button
                    type="button"
                    onClick={() => void handleCreateCircleWallet()}
                    disabled={!circleApiReady || circleWalletCreationInFlight}
                  >
                    <Wallet className="h-4 w-4" />
                    {circleWalletCreationInFlight ? 'Creating…' : 'Create dev wallet'}
                  </Button>
                </div>
                <div className="mt-4 rounded-2xl border border-white/10 bg-background/50 p-4 text-sm text-muted-foreground">
                  {circleStatusQuery.isFetching ? 'Loading live Circle state…' : circleStatusMessage}
                </div>
                <div className="mt-3 rounded-2xl border border-white/10 bg-background/50 p-4 text-sm text-muted-foreground">
                  {circleCreateMessage}
                </div>
                {circleControlPlane?.notes?.length ? (
                  <div className="mt-3 flex flex-wrap gap-2">
                    {circleControlPlane.notes.map((note) => (
                      <Badge key={note} variant="outline">
                        {note}
                      </Badge>
                    ))}
                  </div>
                ) : null}
              </div>
              <a
                className="inline-flex items-center gap-1 text-sm text-primary hover:underline"
                href={circleSkillsPageUrl}
                target="_blank"
                rel="noreferrer"
              >
                Open Circle AI skills
                <ExternalLink className="h-3.5 w-3.5" />
              </a>
            </CardContent>
          </Card>

          <Card className="border-emerald-500/20 bg-emerald-500/5 lg:col-span-12">
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardDescription>Arc agent</CardDescription>
                <CardTitle className="mt-1 text-lg">Onchain identity applied to this website</CardTitle>
              </div>
              <ShieldCheck className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant={arcAgentStatusTone === 'success' ? 'success' : 'warning'}>{arcAgentStatusLabel}</Badge>
                <Badge variant="outline">{`Agent ${arcAgentId.toString()}`}</Badge>
                <Badge variant={arcAgentOwnerMatches ? 'success' : 'warning'}>
                  {arcAgentOwnerMatches ? 'Onchain owner verified' : 'Onchain owner check'}
                </Badge>
                <Badge variant={arcAgentValidationResponse === 100 ? 'success' : 'outline'}>
                  {arcAgentValidationResponse === 100
                    ? `Validation ${arcAgentValidationTag}`
                    : 'Validation pending'}
                </Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Onchain owner</div>
                  <div className="mt-2 text-foreground">{arcAgentOwner ?? 'Loading onchain owner...'}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Validator</div>
                  <div className="mt-2 text-foreground">{arcAgentValidationValidator ?? arcAgentValidatorAddress}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Metadata URI</div>
                  <div className="mt-2 break-all text-foreground">{arcAgentTokenUri}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Validation</div>
                  <div className="mt-2 text-foreground">
                    {arcAgentValidation
                      ? `${arcAgentValidationResponse} · ${arcAgentValidationTagValue} · block ${arcAgentValidationLastUpdate?.toString()}`
                      : 'Waiting for validation state...'}
                  </div>
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm text-muted-foreground">
                This site now surfaces the registered Arc agent onchain state directly from Arc Testnet, so the UI and
                the agent share the same trust anchor.
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Validation hash</div>
                  <div className="mt-2 break-all text-foreground">{truncateAddress(activeArcAgentValidationRequestHash, 10, 8)}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Reputation tag</div>
                  <div className="mt-2 text-foreground">{arcAgentActivationReputationTag}</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Activation status</div>
                  <div className="mt-2 text-foreground">
                    {arcAgentWakeInFlight ? 'Waking agent...' : arcAgentWakeMessage}
                  </div>
                </div>
              </div>
              <div className="grid gap-3 md:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Operational brief</div>
                  <div className="mt-2 text-foreground">
                    {arcAgentBriefInFlight ? 'Briefing agent...' : arcAgentBriefMessage}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Recommended action</div>
                  <div className="mt-2 text-foreground">
                    {lastArcAgentBrief ? formatArcAgentRecommendationAction(lastArcAgentBrief.recommendation.action) : 'Run brief'}
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Confidence</div>
                  <div className="mt-2 text-foreground">
                    {lastArcAgentBrief ? `${Math.round(lastArcAgentBrief.recommendation.confidence * 100)}%` : '--'}
                  </div>
                </div>
              </div>
              {lastArcAgentBrief ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Brief headline</div>
                    <div className="mt-2 text-foreground">{lastArcAgentBrief.recommendation.headline}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Why</div>
                    <div className="mt-2 text-foreground">{lastArcAgentBrief.recommendation.detail}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Next steps</div>
                    <div className="mt-2 space-y-1 text-foreground">
                      {lastArcAgentBrief.recommendation.nextSteps.map((step) => (
                        <div key={step}>{step}</div>
                      ))}
                    </div>
                  </div>
                </div>
              ) : null}
              {lastArcAgentActivation ? (
                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Request tx</div>
                    <div className="mt-2 break-all text-foreground">
                      {formatTx(lastArcAgentActivation.txHashes.validationRequest)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Reputation tx</div>
                    <div className="mt-2 break-all text-foreground">
                      {formatTx(lastArcAgentActivation.txHashes.reputation)}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Validation tx</div>
                    <div className="mt-2 break-all text-foreground">
                      {formatTx(lastArcAgentActivation.txHashes.validationResponse)}
                    </div>
                  </div>
                </div>
              ) : null}
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  type="button"
                  onClick={() => void handleWakeArcAgent()}
                  disabled={arcAgentWakeInFlight}
                >
                  <RefreshCcw className="h-4 w-4" />
                  {arcAgentWakeInFlight ? 'Waking…' : 'Wake agent'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleRunArcAgentBrief()}
                  disabled={arcAgentBriefInFlight}
                >
                  <FileText className="h-4 w-4" />
                  {arcAgentBriefInFlight ? 'Briefing…' : 'Run brief'}
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => void handleActOnArcAgentBrief()}
                  disabled={arcAgentBriefInFlight || arcAgentWakeInFlight}
                >
                  <Send className="h-4 w-4" />
                  {lastArcAgentBrief
                    ? `Run ${formatArcAgentRecommendationAction(lastArcAgentBrief.recommendation.action)}`
                    : 'Act on brief'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => window.open(`${arcTestnetExplorerUrl}/address/${arcAgentIdentityRegistryAddress}`, '_blank', 'noreferrer')}
                >
                  <ExternalLink className="h-4 w-4" />
                  Open identity registry
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 xl:grid-cols-[minmax(0,1.7fr)_minmax(360px,0.9fr)]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Wallet controls</CardTitle>
                <CardDescription>Connect a wallet for live signing, or stay in public demo mode and inspect the Arc Testnet details.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-3">
                  {!isConnected ? (
                    <Button type="button" onClick={() => void handleConnect()} disabled={isConnecting}>
                      <Wallet className="h-4 w-4" />
                      {isConnecting ? 'Connecting…' : 'Connect live wallet'}
                    </Button>
                  ) : (
                    <>
                      <Button type="button" variant="secondary" onClick={handleDisconnect}>
                        Disconnect
                      </Button>
                      <Button type="button" variant="outline" onClick={() => void handleCopyAddress()} disabled={!address}>
                        <Copy className="h-4 w-4" />
                        Copy address
                      </Button>
                    </>
                  )}

                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void handleSwitchChain()}
                    disabled={!isConnected || isSwitching}
                    >
                      <RefreshCcw className="h-4 w-4" />
                      {isSwitching ? 'Switching…' : 'Switch to Arc Testnet'}
                    </Button>
                  <Button
                      type="button"
                      onClick={() => void handleExecuteStablecoinPolicy()}
                      disabled={submissionInFlight}
                    >
                      <Send className="h-4 w-4" />
                      {submissionInFlight
                        ? 'Executing…'
                        : stablecoinExecutionAction === 'top_up'
                          ? 'Execute top-up'
                          : stablecoinExecutionAction === 'trim'
                            ? 'Execute trim'
                            : 'Execute policy update'}
                    </Button>
                  </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Arc RPC</div>
                    <div className="mt-2 break-all text-sm text-foreground">{arcTestnetRpcUrl}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Explorer</div>
                    <a
                      className="mt-2 inline-flex items-center gap-1 text-sm text-primary hover:underline"
                      href={arcTestnetExplorerUrl}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Open Arc Scan
                      <ExternalLink className="h-3.5 w-3.5" />
                    </a>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">USDC token</div>
                    <div className="mt-2 break-all text-sm text-foreground">{arcUsdcAddress}</div>
                  </div>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Policy update</CardTitle>
                <CardDescription>Load the deployed policy, edit the draft, and submit in live or demo mode.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="minThreshold">Minimum threshold</Label>
                    <Input
                      id="minThreshold"
                      inputMode="decimal"
                      value={draftPolicy.minThreshold}
                      onChange={(event) =>
                        setDraftPolicy((current) => ({
                          ...current,
                          minThreshold: Number(event.target.value) || 0,
                        }))
                      }
                      placeholder="100"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="targetBalance">Target balance</Label>
                    <Input
                      id="targetBalance"
                      inputMode="decimal"
                      value={draftPolicy.targetBalance}
                      onChange={(event) =>
                        setDraftPolicy((current) => ({
                          ...current,
                          targetBalance: Number(event.target.value) || 0,
                        }))
                      }
                      placeholder="500"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="maxRebalanceAmount">Max rebalance amount</Label>
                    <Input
                      id="maxRebalanceAmount"
                      inputMode="decimal"
                      value={draftPolicy.maxRebalanceAmount}
                      onChange={(event) =>
                        setDraftPolicy((current) => ({
                          ...current,
                          maxRebalanceAmount: Number(event.target.value) || 0,
                        }))
                      }
                      placeholder="200"
                    />
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button
                    variant="outline"
                    onClick={() => void handleRefreshChainPolicy()}
                    disabled={!contractAddress || policyQuery.isFetching}
                  >
                    <RefreshCcw className="h-4 w-4" />
                    {policyQuery.isFetching ? 'Loading…' : 'Load current policy'}
                  </Button>
                  <Button
                    onClick={() => void handleSubmitPolicy()}
                    disabled={isWriting || submissionInFlight}
                  >
                    <Send className="h-4 w-4" />
                    {isWriting || submissionInFlight ? 'Submitting…' : 'Submit policy update'}
                  </Button>
                  <Badge variant={hasUnsavedChanges ? 'warning' : 'success'}>
                    {hasUnsavedChanges ? 'Draft differs from chain' : 'Draft synced'}
                  </Badge>
                </div>

                <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm text-muted-foreground">
                  Live policy writes use the operator wallet on Arc Testnet. Public visitors can still edit the draft
                  and save a local demo copy in this browser session.
                </div>

                <Separator />

                <div className="text-sm text-muted-foreground">
                  {lastValidationError ? (
                    <span className="text-slate-300">{lastValidationError}</span>
                  ) : contractAddress ? (
                    'Draft values are validated locally before a live transaction or demo save.'
                  ) : (
                    'Set TREASURY_POLICY_ADDRESS before attempting a live policy update.'
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Deployment notes</CardTitle>
                <CardDescription>Keep the repo testnet-only and wire the deploy/runtime env values explicitly.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Live operator</div>
                  <div className="mt-2 text-sm text-foreground">
                    The contract accepts updates from the live operator wallet. Public demo mode keeps the flow
                    interactive without a signed transaction.
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Arc only</div>
                  <div className="mt-2 text-sm text-foreground">
                    The dashboard reads and writes the Arc Testnet deployment only.
                  </div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Env driven</div>
                  <div className="mt-2 text-sm text-foreground">
                    RPC URL and contract address come from the shell or `.env.local`.
                  </div>
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="space-y-6">
            <Card className="sticky top-6">
              <CardHeader>
                <div className="flex items-center gap-2">
                  <Activity className="h-5 w-5 text-primary" />
                  <CardTitle>Activity log</CardTitle>
                </div>
                <CardDescription>Recent wallet, contract, and simulation events.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {activity.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-background/40 p-5 text-sm text-muted-foreground">
                    No activity yet. Connect a wallet or load the onchain policy to begin.
                  </div>
                ) : (
                  activity.map((item) => (
                    <div key={item.id} className="rounded-2xl border border-white/10 bg-background/50 p-4">
                      <div className="flex items-center justify-between gap-3">
                        <div className="font-medium text-foreground">{item.title}</div>
                        <Badge
                          variant={activityBadgeVariant(item.tone)}
                        >
                          {item.tone}
                        </Badge>
                      </div>
                      <div className="mt-2 text-sm text-muted-foreground">{item.detail}</div>
                      <div className="mt-3 text-xs text-muted-foreground">{formatTimestamp(item.createdAt)}</div>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Builder evidence</CardTitle>
                <CardDescription>
                  What reviewers should open first when they want to verify the build from GitHub to chain.
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                {builderReferenceLinks.map((link) => (
                  <a
                    key={link.label}
                    className="block rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
                    href={link.href}
                    target="_blank"
                    rel="noreferrer"
                  >
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{link.label}</div>
                    <div className="mt-2 break-all text-sm text-foreground">{link.value}</div>
                  </a>
                ))}
                <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  Live settlement still uses the operator wallet on Arc Testnet. Public demo mode stays interactive
                  without a wallet, so the site remains usable for visitors and reviewers.
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </main>
  )
}

function formatValidationError(policy: TreasuryPolicy): string | null {
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
