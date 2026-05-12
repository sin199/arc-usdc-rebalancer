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
  arcAgentIdentityAbi,
  arcAgentIdentityRegistryAddress,
  arcAgentMetadataUri,
  arcAgentOwnerAddress,
  arcAgentValidationAbi,
  arcAgentValidationRegistryAddress,
  arcAgentValidationRequestHash,
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
    'Connect the owner wallet to submit the onchain policy update.',
  )
  const [stablecoinTestMessage, setStablecoinTestMessage] = useState<string>(
    'Run the stablecoin robot test to inspect live USDC policy state.',
  )
  const [stablecoinExecutionMessage, setStablecoinExecutionMessage] = useState<string>(
    'Owner wallet execution will submit the current policy to chain.',
  )
  const [executorDeployMessage, setExecutorDeployMessage] = useState<string>(
    'Deploy TreasuryExecutor from the owner wallet to enable live stablecoin execution.',
  )
  const [circleStatusMessage, setCircleStatusMessage] = useState<string>(
    'Refresh the Circle control plane or create a dev wallet to start the live wallet and bridge flow.',
  )
  const [circleCreateMessage, setCircleCreateMessage] = useState<string>(
    'Circle wallet creation will provision a dev-controlled wallet on Arc Testnet.',
  )
  const [localCircleWalletSetId, setLocalCircleWalletSetId] = useState<string | undefined>()
  const [circleWalletCreationInFlight, setCircleWalletCreationInFlight] = useState(false)
  const [lastValidationError, setLastValidationError] = useState<string | null>(null)
  const [submissionInFlight, setSubmissionInFlight] = useState(false)
  const [executorDeploymentInFlight, setExecutorDeploymentInFlight] = useState(false)
  const chainPolicyInitializedRef = useRef(false)
  const configuredCircleWalletSetId = process.env.NEXT_PUBLIC_CIRCLE_WALLET_SET_ID?.trim() || undefined
  const circleWalletSetId = configuredCircleWalletSetId ?? localCircleWalletSetId

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
    args: [arcAgentValidationRequestHash],
    query: {
      refetchInterval: 30_000,
      staleTime: 10_000,
    },
  })

  const chainPolicy = policyQuery.data ? formatTreasuryPolicyFromUnits(policyQuery.data) : null
  const ownerAddress = ownerQuery.data
  const connectedWalletIsOwner =
    address !== undefined &&
    ownerAddress !== undefined &&
    address.toLowerCase() === ownerAddress.toLowerCase()

  const currentPolicy = chainPolicy ?? draftPolicy
  const treasuryBalance = Number(treasuryBalanceQuery.data?.formatted ?? 0)
  const evaluation = isConnected ? evaluatePolicy(treasuryBalance, currentPolicy) : null
  const stablecoinExecutionFloor = 0.01
  const stablecoinExecutionAmount =
    evaluation && evaluation.amount > 0 ? evaluation.amount : stablecoinExecutionFloor
  const stablecoinExecutionAction: 'top_up' | 'trim' =
    evaluation?.action === 'trim' && evaluation.amount > 0 ? 'trim' : 'top_up'
  const hasUnsavedChanges = Boolean(chainPolicy) && !policiesEqual(draftPolicy, chainPolicy as TreasuryPolicy)
  const stablecoinBalance = treasuryBalance
  const stablecoinRobotStatus: StablecoinRobotStatus = !isConnected
    ? 'wait'
    : !walletOnArc || !contractAddress || !chainPolicy || !executorAddress
      ? 'warn'
      : evaluation?.status === 'healthy'
        ? 'pass'
        : 'warn'
  const stablecoinRobotConfidence = !isConnected
    ? 0.18
    : stablecoinRobotStatus === 'pass'
      ? 0.96
      : stablecoinRobotStatus === 'warn'
        ? 0.72
        : 0.25
  const stablecoinRobotReasonCodes = !isConnected
    ? ['CONNECT_WALLET']
    : !walletOnArc
      ? ['SWITCH_TO_ARC_TESTNET']
      : !contractAddress
      ? ['MISSING_POLICY_ADDRESS']
      : !chainPolicy
        ? ['POLICY_LOADING']
          : !executorAddress
          ? ['MISSING_EXECUTOR_ADDRESS']
        : [...(evaluation?.reasonCodes ?? ['POLICY_READ_ONLY'])]
  const stablecoinRobotExecutionReady = Boolean(
    isConnected &&
      walletOnArc &&
      contractAddress &&
      chainPolicy &&
      executorAddress &&
      connectedWalletIsOwner &&
      !submissionInFlight &&
      formatValidationError(draftPolicy) === null,
  )
  const stablecoinRobotExecutionReason = !isConnected
    ? 'Connect the wallet first.'
    : !walletOnArc
      ? 'Switch the wallet to Arc Testnet.'
      : !contractAddress
      ? 'Set TREASURY_POLICY_ADDRESS before executing.'
      : !chainPolicy
        ? 'Load the deployed policy before executing.'
        : !executorAddress
          ? 'Set TREASURY_EXECUTOR_ADDRESS before executing.'
          : !connectedWalletIsOwner
            ? 'Only the contract owner can execute the policy update.'
            : formatValidationError(draftPolicy) ?? 'Execution is temporarily blocked.'
  const stablecoinEvaluationMessage = evaluation?.message ?? 'Treasury balance is outside the healthy band.'
  const stablecoinRobotSummary =
    stablecoinRobotStatus === 'pass'
      ? 'USDC balance is inside the healthy policy band.'
      : stablecoinRobotStatus === 'warn'
        ? `Policy test indicates ${stablecoinEvaluationMessage.toLowerCase()}.`
        : 'Connect a wallet to run the stablecoin policy test.'
  const stablecoinRobotChecks = [
    {
      label: 'Wallet connected',
      passed: isConnected,
      detail: isConnected ? 'Wallet is connected to the dashboard.' : 'Connect an injected wallet to read live balance.',
    },
    {
      label: 'Arc Testnet',
      passed: walletOnArc,
      detail: walletOnArc ? 'Wallet is pointed at Arc Testnet.' : 'Switch the connected wallet to Arc Testnet.',
    },
    {
      label: 'Policy loaded',
      passed: Boolean(chainPolicy),
      detail: chainPolicy
        ? 'Deployed TreasuryPolicy values are available.'
        : 'Set TREASURY_POLICY_ADDRESS to load the deployed policy.',
    },
    {
      label: 'Executor loaded',
      passed: Boolean(executorAddress),
      detail: executorAddress
        ? 'TreasuryExecutor is configured for USDC movements.'
        : 'Set TREASURY_EXECUTOR_ADDRESS to enable onchain execution.',
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
          ? `Execution amount ${formatUsdc(stablecoinExecutionAmount)} USDC will be submitted.`
          : `Test floor ${formatUsdc(stablecoinExecutionFloor)} USDC will be submitted to exercise MetaMask.`,
    },
  ]

  const circleStackStatus: StablecoinRobotStatus = !isConnected
    ? 'wait'
    : walletOnArc && connectedWalletIsOwner && chainPolicy && executorAddress
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
      passed: walletOnArc,
      detail: walletOnArc
        ? `Wallet is on Arc Testnet (chain ${arcTestnetChainId}).`
        : 'Switch the connected wallet to Arc Testnet.',
    },
    {
      label: 'Owner wallet',
      passed: connectedWalletIsOwner,
      detail: connectedWalletIsOwner
        ? 'Connected wallet matches the TreasuryPolicy owner.'
        : ownerAddress
          ? 'Connect the owner wallet before executing the Circle line.'
          : 'Owner address is still loading.',
    },
    {
      label: 'Treasury policy',
      passed: Boolean(chainPolicy),
      detail: chainPolicy
        ? 'TreasuryPolicy is loaded from chain.'
        : 'Load TreasuryPolicy to complete the Circle line.',
    },
    {
      label: 'Treasury executor',
      passed: Boolean(executorAddress),
      detail: executorAddress
        ? `TreasuryExecutor configured at ${truncateAddress(executorAddress)}.`
        : 'Set TREASURY_EXECUTOR_ADDRESS to enable stablecoin moves.',
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
          : 'Set the deployed TreasuryPolicy address to enable live policy reads and owner writes.',
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
      setSimulationMessage('Wallet connected. Review the onchain policy or submit the draft from the owner wallet.')
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
    setSimulationMessage('Wallet disconnected. Reconnect to resume policy checks and contract updates.')
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
    if (!isConnected) {
      setSimulationMessage('Connect the owner wallet before submitting a policy update.')
      return false
    }

    if (!walletOnArc) {
      setSimulationMessage('Switch the wallet to Arc Testnet before submitting the policy update.')
      return false
    }

    if (!contractAddress) {
      setSimulationMessage('Set TREASURY_POLICY_ADDRESS before submitting a policy update.')
      setLastValidationError('Deployed TreasuryPolicy address is missing or invalid.')
      return false
    }

    if (!connectedWalletIsOwner) {
      setSimulationMessage('Only the contract owner wallet can submit policy updates.')
      pushActivity({
        title: 'Policy update blocked',
        detail: 'The connected wallet does not match the onchain owner.',
        tone: 'warning',
      })
      return false
    }

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
    if (!isConnected) {
      setSimulationMessage('Connect a wallet before simulating a rebalance.')
      return
    }

    const result = evaluatePolicy(Number(treasuryBalanceQuery.data?.formatted ?? 0), currentPolicy)
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

  async function handleExecuteStablecoinPolicy() {
    let activeWalletAddress = address ?? null
    let activeExecutorAddress = executorAddress ?? null

    if (!activeWalletAddress) {
      setStablecoinExecutionMessage('Connecting the owner wallet before execution...')
      activeWalletAddress = await handleConnect()
      if (!activeWalletAddress) {
        setStablecoinExecutionMessage('Execution blocked: connect the owner wallet first.')
        return
      }
    }

    if (!walletOnArc) {
      setStablecoinExecutionMessage('Switching the wallet to Arc Testnet before execution...')
      const switched = await handleSwitchChain()
      if (!switched) {
        setStablecoinExecutionMessage('Execution blocked: switch the wallet to Arc Testnet first.')
        return
      }
    }

    if (!ownerAddress || activeWalletAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
      const reason = 'Only the contract owner can execute the policy update.'
      setStablecoinExecutionMessage(reason)
      pushActivity({
        title: 'Stablecoin execution blocked',
        detail: reason,
        tone: 'warning',
      })
      return
    }

    if (!activeExecutorAddress) {
      setStablecoinExecutionMessage('Deploying TreasuryExecutor before execution...')
      activeExecutorAddress = activeWalletAddress
        ? await deployExecutorForWallet(activeWalletAddress)
        : await handleDeployExecutor()
      if (!activeExecutorAddress) {
        setStablecoinExecutionMessage('Execution blocked: deploy TreasuryExecutor first.')
        return
      }
    }

    if (!publicClient || !activeExecutorAddress) {
      setStablecoinExecutionMessage('Execution failed. Treasury executor address or public client is unavailable.')
      return
    }

    const amountUnits = parseUnits(String(stablecoinExecutionAmount), arcUsdcDecimals)
    if (amountUnits <= 0n || !evaluation) {
      setStablecoinExecutionMessage('Execution skipped. No rebalance amount is required.')
      return
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
          detail: `TreasuryExecutor sent ${formatUsdc(stablecoinExecutionAmount)} USDC back to the owner wallet. Tx ${formatTx(trimHash)}.`,
          tone: 'success',
        })
        setStablecoinExecutionMessage(
          `Trim confirmed. ${formatUsdc(stablecoinExecutionAmount)} USDC moved back to the owner wallet.`,
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setStablecoinExecutionMessage(`Execution failed: ${message}`)
      pushActivity({
        title: 'Stablecoin execution failed',
        detail: message,
        tone: 'warning',
      })
    } finally {
      setSubmissionInFlight(false)
    }
  }

  async function deployExecutorForWallet(activeWalletAddress: Address): Promise<Address | null> {
    if (!ownerAddress || activeWalletAddress.toLowerCase() !== ownerAddress.toLowerCase()) {
      setExecutorDeployMessage('Only the contract owner wallet should deploy TreasuryExecutor.')
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
        detail: `Contract deployed to ${truncateAddress(deployedAddress)} from the owner wallet.`,
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
    let activeWalletAddress = address ?? null

    if (!isConnected) {
      setExecutorDeployMessage('Connect the owner wallet before deploying TreasuryExecutor.')
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

  const currentStatus = isConnected ? evaluation?.status ?? 'healthy' : null
  const policySyncBadge =
    chainPolicy && policiesEqual(draftPolicy, chainPolicy) ? 'Synced with chain' : chainPolicy ? 'Draft differs' : 'Draft only'
  const policySyncVariant = chainPolicy ? (policiesEqual(draftPolicy, chainPolicy) ? 'success' : 'warning') : 'outline'
  const policyCardTitle = chainPolicy ? 'Current policy from chain' : 'Current policy unavailable'
  const policyCardDescription =
    treasuryPolicyAddressConfig.status === 'configured'
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

  return (
    <main className="min-h-screen pb-16">
      <SiteHeader
        eyebrow="Treasury dashboard"
        title="Arc USDC Rebalancer"
        description="Read the deployed TreasuryPolicy, submit owner-signed updates, and simulate rebalance status against Arc Testnet."
        ctaHref="/"
        ctaLabel="Back to landing"
      />

      <div className="sticky top-4 z-20">
        <div className="mx-auto w-full max-w-6xl px-4 sm:px-6 lg:px-8">
          <div className="rounded-3xl border border-white/10 bg-background/90 p-4 shadow-[0_20px_60px_-32px_rgba(15,23,42,0.85)] backdrop-blur">
          <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Quick actions</div>
              <div className="mt-1 text-sm text-muted-foreground">
                Keep the wallet, network, deployment, and execution controls visible without scrolling.
              </div>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant={isConnected ? 'success' : 'outline'}>{isConnected ? 'Wallet ready' : 'Wallet disconnected'}</Badge>
              <Badge variant={walletOnArc ? 'success' : 'warning'}>{walletOnArc ? 'Arc Testnet' : 'Switch needed'}</Badge>
              <Badge variant={executorAddress ? 'success' : 'warning'}>
                {executorAddress ? 'Executor ready' : 'Executor missing'}
              </Badge>
              <Badge variant={stablecoinRobotExecutionReady ? 'success' : 'warning'}>
                {stablecoinRobotExecutionReady ? 'Execution ready' : 'Execution blocked'}
              </Badge>
            </div>
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-4">
            {!isConnected ? (
              <Button type="button" className="w-full" onClick={() => void handleConnect()} disabled={isConnecting}>
                <Wallet className="h-4 w-4" />
                {isConnecting ? 'Connecting…' : 'Connect wallet'}
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
            <Button
              type="button"
              className="w-full"
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
        </div>
      </div>
      </div>

      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-8 pt-8 sm:px-6 lg:px-8">

        <div className="grid gap-4 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardDescription>Connected wallet</CardDescription>
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
                  {ownerAddress ? (connectedWalletIsOwner ? 'Owner wallet' : 'Owner required') : 'Owner loading'}
                </Badge>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Wallet balance</div>
                <div className="mt-2 text-foreground">
                  {walletBalanceQuery.data ? `${formatUsdc(Number(walletBalanceQuery.data.formatted ?? 0))} USDC` : 'Connect wallet'}
                </div>
              </div>
              <div>{isConnected ? `Active account ${address}` : 'Connect an injected wallet to continue.'}</div>
            </CardContent>
          </Card>

          <Card>
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
                <span>Owner {ownerLabel}</span>
              </div>
              <div className="text-sm text-muted-foreground">{policyCardDescription}</div>
            </CardContent>
          </Card>

          <Card>
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
                    <Badge variant="outline">Owner {truncateAddress(latestEvent.args.owner)}</Badge>
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
                  No `PolicyUpdated` event has been observed yet. The latest event will appear after the first owner
                  update on Arc Testnet.
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardDescription>Simulated rebalance status</CardDescription>
                <CardTitle className="mt-1 text-lg">
                  {currentStatus ? currentStatus.replace('_', ' ') : 'Awaiting wallet'}
                </CardTitle>
              </div>
              <ArrowRightLeft className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              <div className="grid gap-3 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Balance</div>
                  <div className="mt-2 text-foreground">
                    {isConnected ? `${formatUsdc(Number(treasuryBalanceQuery.data?.formatted ?? 0))} USDC` : 'Connect wallet'}
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
                  {evaluation?.status ?? 'Awaiting wallet'}
                </Badge>
                {evaluation?.reasonCodes.map((reasonCode) => (
                  <Badge key={reasonCode} variant="outline">
                    {reasonCode}
                  </Badge>
                ))}
              </div>
              <div className="flex flex-wrap items-center gap-3">
                <Button variant="outline" onClick={() => void handleSimulateRebalance()} disabled={!isConnected}>
                  <ArrowRightLeft className="h-4 w-4" />
                  Simulate rebalance
                </Button>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm text-muted-foreground">
                {simulationMessage}
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/20 bg-primary/5">
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

          <Card className="border-cyan-500/20 bg-cyan-500/5">
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

          <Card className="border-emerald-500/20 bg-emerald-500/5">
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
                  {arcAgentOwnerMatches ? 'Owner verified' : 'Owner check'}
                </Badge>
                <Badge variant={arcAgentValidationResponse === 100 ? 'success' : 'outline'}>
                  {arcAgentValidationResponse === 100
                    ? `Validation ${arcAgentValidationTag}`
                    : 'Validation pending'}
                </Badge>
              </div>
              <div className="grid gap-3 md:grid-cols-2">
                <div className="rounded-2xl border border-white/10 bg-background/50 p-3">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Owner</div>
                  <div className="mt-2 text-foreground">{arcAgentOwner ?? 'Loading owner...'}</div>
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
              <div className="flex flex-wrap items-center gap-3">
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

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Wallet controls</CardTitle>
                <CardDescription>Connect, switch the wallet, and inspect the Arc Testnet deployment details.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="flex flex-wrap gap-3">
                  {!isConnected ? (
                    <Button type="button" onClick={() => void handleConnect()} disabled={isConnecting}>
                      <Wallet className="h-4 w-4" />
                      {isConnecting ? 'Connecting…' : 'Connect wallet'}
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
                <CardDescription>Load the deployed policy, edit the draft, and submit from the owner wallet.</CardDescription>
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
                    disabled={
                      !isConnected ||
                      !walletOnArc ||
                      !contractAddress ||
                      !connectedWalletIsOwner ||
                      isWriting ||
                      submissionInFlight
                    }
                  >
                    <Send className="h-4 w-4" />
                    {isWriting || submissionInFlight ? 'Submitting…' : 'Submit policy update'}
                  </Button>
                  <Badge variant={hasUnsavedChanges ? 'warning' : 'success'}>
                    {hasUnsavedChanges ? 'Draft differs from chain' : 'Draft synced'}
                  </Badge>
                </div>

                <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm text-muted-foreground">
                  Only the owner wallet can call `setPolicy` on Arc Testnet. The deployed contract address comes from
                  the frontend env config.
                </div>

                <Separator />

                <div className="text-sm text-muted-foreground">
                  {lastValidationError ? (
                    <span className="text-amber-300">{lastValidationError}</span>
                  ) : contractAddress ? (
                    'Draft values are validated locally before the owner wallet sends the transaction.'
                  ) : (
                    'Set TREASURY_POLICY_ADDRESS before attempting any onchain policy update.'
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
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Owner-gated</div>
                  <div className="mt-2 text-sm text-foreground">
                    The contract accepts updates only from the connected owner wallet.
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
                          variant={
                            item.tone === 'success' ? 'success' : item.tone === 'warning' ? 'warning' : 'outline'
                          }
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
                <CardTitle>Quick checks</CardTitle>
                <CardDescription>What the dashboard needs before a policy update can land on Arc Testnet.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  Connect the owner wallet and switch it to Arc Testnet before submitting.
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  Set <span className="text-foreground">TREASURY_POLICY_ADDRESS</span> so the frontend can read and write
                  the deployed contract.
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  Use the Foundry deployment script to broadcast the contract and seed the initial policy values.
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
