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
  useSwitchChain,
  useWriteContract,
} from 'wagmi'
import {
  Activity,
  ArrowRightLeft,
  Copy,
  ExternalLink,
  FileText,
  RefreshCcw,
  Send,
  Wallet,
} from 'lucide-react'
import {
  ACTIVITY_LOG_STORAGE_KEY,
  arcTestnetChainId,
  arcTestnetExplorerUrl,
  arcUsdcAddress,
  DEFAULT_TREASURY_POLICY,
  evaluatePolicy,
  formatUsdc,
  treasuryPolicyContractAbi,
  treasuryPolicyUpdatedEvent,
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
import { ExecutionConsole } from '@/components/execution-console'
import { readJson, writeJson } from '@/lib/storage'
import {
  arcTestnetRpcUrl,
  formatTreasuryPolicyAmount,
  formatTreasuryPolicyFromUnits,
  parseTreasuryPolicyToUnits,
  treasuryPolicyAddressConfig,
} from '@/lib/treasury-policy'
import { arcTestnet } from '@/lib/wagmi'

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

export function TreasuryDashboard() {
  const { address, chainId, isConnected } = useAccount()
  const { connectors, connectAsync, isPending: isConnecting } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain()
  const publicClient = usePublicClient({ chainId: arcTestnet.id })
  const { writeContractAsync, isPending: isWriting } = useWriteContract()
  const contractAddress = treasuryPolicyAddressConfig.address
  const walletOnArc = isConnected && chainId === arcTestnet.id
  const walletSummary = isConnected && address ? truncateAddress(address) : 'No wallet connected'

  const balanceQuery = useBalance({
    address,
    chainId: arcTestnet.id,
    query: {
      enabled: Boolean(address),
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
  const [lastValidationError, setLastValidationError] = useState<string | null>(null)
  const [submissionInFlight, setSubmissionInFlight] = useState(false)
  const chainPolicyInitializedRef = useRef(false)

  const chainPolicy = policyQuery.data ? formatTreasuryPolicyFromUnits(policyQuery.data) : null
  const ownerAddress = ownerQuery.data
  const connectedWalletIsOwner =
    address !== undefined &&
    ownerAddress !== undefined &&
    address.toLowerCase() === ownerAddress.toLowerCase()

  const currentPolicy = chainPolicy ?? draftPolicy
  const evaluation = isConnected ? evaluatePolicy(Number(balanceQuery.data?.formatted ?? 0), currentPolicy) : null
  const hasUnsavedChanges = Boolean(chainPolicy) && !policiesEqual(draftPolicy, chainPolicy as TreasuryPolicy)

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

  async function handleConnect() {
    const injectedConnector = connectors[0]

    if (!injectedConnector) {
      pushActivity({
        title: 'No injected wallet found',
        detail: 'Install an injected wallet such as MetaMask or Rabby, then refresh the page.',
        tone: 'warning',
      })
      return
    }

    try {
      await connectAsync({ connector: injectedConnector })
      pushActivity({
        title: 'Wallet connected',
        detail: `Connected through ${injectedConnector.name} and ready for Arc Testnet.`,
        tone: 'success',
      })
      setSimulationMessage('Wallet connected. Review the onchain policy or submit the draft from the owner wallet.')
    } catch {
      pushActivity({
        title: 'Wallet connection failed',
        detail: 'The injected wallet rejected the connection request.',
        tone: 'warning',
      })
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
    } catch {
      pushActivity({
        title: 'Network switch needs manual approval',
        detail: `Add or select Arc Testnet manually. RPC: ${arcTestnetRpcUrl}`,
        tone: 'warning',
      })
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

  async function handleSubmitPolicy() {
    if (!isConnected) {
      setSimulationMessage('Connect the owner wallet before submitting a policy update.')
      return
    }

    if (!walletOnArc) {
      setSimulationMessage('Switch the wallet to Arc Testnet before submitting the policy update.')
      return
    }

    if (!contractAddress) {
      setSimulationMessage('Set TREASURY_POLICY_ADDRESS before submitting a policy update.')
      setLastValidationError('Deployed TreasuryPolicy address is missing or invalid.')
      return
    }

    if (!connectedWalletIsOwner) {
      setSimulationMessage('Only the contract owner wallet can submit policy updates.')
      pushActivity({
        title: 'Policy update blocked',
        detail: 'The connected wallet does not match the onchain owner.',
        tone: 'warning',
      })
      return
    }

    const validationError = formatValidationError(draftPolicy)
    setLastValidationError(validationError)

    if (validationError) {
      pushActivity({
        title: 'Policy update blocked',
        detail: validationError,
        tone: 'warning',
      })
      return
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
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error'
      setSimulationMessage(`Policy update failed: ${message}`)
      pushActivity({
        title: 'Policy update failed',
        detail: message,
        tone: 'warning',
      })
    } finally {
      setSubmissionInFlight(false)
    }
  }

  function handleSimulateRebalance() {
    if (!isConnected) {
      setSimulationMessage('Connect a wallet before simulating a rebalance.')
      return
    }

    const result = evaluatePolicy(Number(balanceQuery.data?.formatted ?? 0), currentPolicy)
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

  return (
    <main className="min-h-screen pb-16">
      <SiteHeader
        eyebrow="Treasury dashboard"
        title="Arc USDC Rebalancer"
        description="Read the deployed TreasuryPolicy, submit owner-signed updates, and simulate rebalance status against Arc Testnet."
        ctaHref="/"
        ctaLabel="Back to landing"
      />

      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-8 sm:px-6 lg:px-8">
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
                    {isConnected ? `${formatUsdc(Number(balanceQuery.data?.formatted ?? 0))} USDC` : 'Connect wallet'}
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
                    <Button onClick={() => void handleConnect()} disabled={isConnecting}>
                      <Wallet className="h-4 w-4" />
                      {isConnecting ? 'Connecting…' : 'Connect wallet'}
                    </Button>
                  ) : (
                    <>
                      <Button variant="secondary" onClick={handleDisconnect}>
                        Disconnect
                      </Button>
                      <Button variant="outline" onClick={() => void handleCopyAddress()} disabled={!address}>
                        <Copy className="h-4 w-4" />
                        Copy address
                      </Button>
                    </>
                  )}

                  <Button
                    variant="outline"
                    onClick={() => void handleSwitchChain()}
                    disabled={!isConnected || isSwitching}
                  >
                    <RefreshCcw className="h-4 w-4" />
                    {isSwitching ? 'Switching…' : 'Switch to Arc Testnet'}
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

            <ExecutionConsole />

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
