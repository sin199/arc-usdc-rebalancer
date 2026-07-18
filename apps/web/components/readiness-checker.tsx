'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useAccount, useConnect, useReadContract, useSignMessage } from 'wagmi'
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  RefreshCcw,
  BadgeCheck,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import {
  DEFAULT_TREASURY_POLICY,
  arcTestnetChainId,
  arcTestnetExplorerUrl,
  circleStackSummary,
  formatUsdc,
  treasuryPolicyContractAbi,
} from '@arc-usdc-rebalancer/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SiteHeader } from '@/components/site-header'
import { arcAgentId, arcAgentValidationTag } from '@/lib/arc-agent'
import { buildLiveExecutionMessage } from '@/lib/live-execution-auth'
import { trackProductEvent } from '@/lib/product-analytics'
import { buildReadinessReport } from '@/lib/readiness-report'
import { treasuryExecutorAddressConfig } from '@/lib/treasury-executor'
import {
  arcTestnetRpcUrl,
  formatTreasuryPolicyFromUnits,
  treasuryPolicyAddressConfig,
} from '@/lib/treasury-policy'
import { arcTestnet } from '@/lib/wagmi'

type CircleControlPlaneStatus = {
  notes?: string[]
  readiness?: {
    apiKeyConfigured?: boolean
    entitySecretConfigured?: boolean
    gatewayConfigured?: boolean
    walletBlockchainConfigured?: boolean
    walletSetConfigured?: boolean
  }
  walletSet?: {
    id?: string
    name?: string
  } | null
}

type TreasuryExecutionResponse = {
  action?: 'top_up' | 'trim'
  amountUsdc?: number
  error?: string
  mode?: 'server'
  executorAddress?: `0x${string}`
  ownerAddress?: `0x${string}`
  recipient?: `0x${string}`
  summary?: string
  txHashes?: {
    approve?: `0x${string}`
    execute?: `0x${string}`
  }
}

type LiveExecutionStatus = {
  authorization: 'wallet_signature'
  enabled: boolean
  guardMode: 'memory' | 'redis' | 'unavailable'
  maxAmountUsdc: number
}

const initialPolicy = DEFAULT_TREASURY_POLICY

export function ReadinessChecker() {
  const { address: operatorAddress } = useAccount()
  const { connectAsync, connectors, isPending: isConnecting } = useConnect()
  const { signMessageAsync } = useSignMessage()
  const contractAddress = treasuryPolicyAddressConfig.address
  const executorAddress = treasuryExecutorAddressConfig.address
  const [balance, setBalance] = useState(initialPolicy.targetBalance)
  const [policy, setPolicy] = useState(initialPolicy)
  const [policySourceLabel, setPolicySourceLabel] = useState<
    'Draft policy' | 'Live chain snapshot'
  >('Draft policy')
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const [actionCopyState, setActionCopyState] = useState<'idle' | 'copied'>(
    'idle',
  )
  const [executionState, setExecutionState] = useState<
    'idle' | 'running' | 'done' | 'error'
  >('idle')
  const [executionMessage, setExecutionMessage] = useState(
    'Execution locked until operator wallet and live dependencies are ready. Copy the action pack in preview mode.',
  )
  const [executionResult, setExecutionResult] =
    useState<TreasuryExecutionResponse | null>(null)
  const [walletConnectMessage, setWalletConnectMessage] = useState<
    string | null
  >(null)
  const [walletConnectTone, setWalletConnectTone] = useState<
    'info' | 'success' | 'warning'
  >('info')
  const policyHydratedRef = useRef(false)
  const dashboardStartedAtRef = useRef(Date.now())
  const lastDecisionEventRef = useRef<string | null>(null)

  const policyQuery = useReadContract({
    abi: treasuryPolicyContractAbi,
    address: contractAddress,
    chainId: arcTestnet.id,
    functionName: 'getPolicy',
    query: {
      enabled: Boolean(contractAddress),
    },
  })

  const circleStatusQuery = useQuery<CircleControlPlaneStatus>({
    queryKey: ['readiness-circle-status'],
    queryFn: async () => {
      const response = await fetch('/api/circle/status', {
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error(`Circle status request failed with ${response.status}.`)
      }

      return (await response.json()) as CircleControlPlaneStatus
    },
    refetchInterval: 30_000,
    staleTime: 10_000,
  })

  const liveExecutionStatusQuery = useQuery<LiveExecutionStatus>({
    queryKey: ['live-execution-status'],
    queryFn: async () => {
      const response = await fetch('/api/treasury/execution/status', {
        cache: 'no-store',
      })

      if (!response.ok) {
        throw new Error(
          `Live execution status request failed with ${response.status}.`,
        )
      }

      return (await response.json()) as LiveExecutionStatus
    },
    staleTime: 30_000,
  })

  useEffect(() => {
    if (!policyQuery.data || policyHydratedRef.current) {
      return
    }

    setPolicy(formatTreasuryPolicyFromUnits(policyQuery.data))
    setPolicySourceLabel('Live chain snapshot')
    policyHydratedRef.current = true
  }, [policyQuery.data])

  const circleReadiness = circleStatusQuery.data?.readiness
  const circleReady = Boolean(
    circleReadiness?.apiKeyConfigured &&
    circleReadiness?.entitySecretConfigured &&
    circleReadiness?.walletSetConfigured,
  )
  const circleSummary = circleReady
    ? 'Readiness complete'
    : operatorAddress
      ? 'Readiness incomplete'
      : 'Optional crosschain readiness'
  const policyIsLive = policySourceLabel === 'Live chain snapshot'
  const liveExecutionEnabled = Boolean(liveExecutionStatusQuery.data?.enabled)
  const liveExecutionReady = Boolean(
    liveExecutionEnabled &&
    operatorAddress &&
    contractAddress &&
    policyIsLive &&
    circleReady &&
    executorAddress,
  )
  const operatorWalletConnected = Boolean(operatorAddress)
  const walletConnector =
    connectors.find(
      (connector) =>
        /metamask/i.test(connector.name) || connector.id === 'metaMask',
    ) ??
    connectors.find((connector) => connector.type === 'injected') ??
    connectors[0]
  const liveExecutionBlockers = [
    liveExecutionEnabled
      ? null
      : liveExecutionStatusQuery.data?.guardMode === 'unavailable'
        ? 'Durable replay protection is not configured; live execution fails closed.'
        : 'Live execution is disabled for this deployment.',
    operatorAddress ? null : 'Connect the operator wallet.',
    policyIsLive ? null : 'Load the live onchain policy snapshot.',
    circleReady ? null : 'Finish Circle readiness.',
    executorAddress ? null : 'Deploy or recheck the TreasuryExecutor.',
  ].filter((item): item is string => Boolean(item))
  const liveExecutionLockedMessage =
    'Execution locked until operator wallet and live dependencies are ready.'
  const liveMode = liveExecutionReady
  const modeLabel = liveExecutionReady ? 'Live operator mode' : 'Preview mode'
  const report = buildReadinessReport({
    agentId: arcAgentId.toString(),
    agentTag: arcAgentValidationTag,
    balance,
    circleNotes: circleStatusQuery.data?.notes ?? [],
    circleReady,
    circleSummary,
    contractAddress: contractAddress ? `${contractAddress}` : undefined,
    executorAddress: executorAddress ? `${executorAddress}` : undefined,
    generatedAt: new Date().toISOString(),
    liveExecutionEnabled,
    liveMode,
    modeLabel,
    policy,
    policySourceLabel,
    operatorAddress: operatorAddress ?? undefined,
    walletSetId: circleStatusQuery.data?.walletSet?.id,
  })
  const actionCommandsText = report.actionPack.commands
    .map((command) => `### ${command.label}\n${command.command}`)
    .join('\n\n')
  const actionPayloadText = JSON.stringify(report.actionPack.payload, null, 2)
  const canRunLiveAction = liveExecutionReady && report.actionPack.actionable
  const showLiveExecutionControls =
    liveExecutionReady && report.actionPack.actionable
  const liveExecutionStatusMessage = showLiveExecutionControls
    ? 'Live execution is ready.'
    : liveExecutionReady
      ? 'No live transaction is needed for the current report.'
      : `${liveExecutionLockedMessage} ${liveExecutionBlockers.join(' ')}`
  const actionPackStatusMessage =
    executionState === 'idle' ? liveExecutionStatusMessage : executionMessage
  const liveActionLabel =
    executionState === 'running'
      ? 'Running…'
      : liveExecutionReady
        ? report.action === 'top_up'
          ? 'Authorize & run top-up'
          : report.action === 'trim'
            ? 'Authorize & run trim'
            : 'Run live action'
        : 'Execution locked'

  useEffect(() => {
    if (!operatorWalletConnected) {
      return
    }

    setWalletConnectTone('success')
    setWalletConnectMessage(
      `Operator wallet connected${operatorAddress ? `: ${operatorAddress}` : '.'}`,
    )
  }, [operatorAddress, operatorWalletConnected])

  function hasInjectedWalletProvider() {
    if (typeof window === 'undefined') {
      return false
    }

    const injectedWindow = window as Window & {
      ethereum?: unknown
    }

    return Boolean(injectedWindow.ethereum)
  }

  async function handleConnectOperatorWallet() {
    setWalletConnectTone('info')

    if (!walletConnector) {
      setWalletConnectTone('warning')
      setWalletConnectMessage(
        'No injected wallet detected. Install MetaMask or Rabby, or open this page in a wallet-enabled browser.',
      )
      return
    }

    if (!hasInjectedWalletProvider()) {
      setWalletConnectTone('warning')
      setWalletConnectMessage(
        'No injected wallet detected. Install MetaMask or Rabby, or open this page in a wallet-enabled browser.',
      )
      return
    }

    try {
      setWalletConnectMessage('Waiting for wallet connection prompt…')
      const result = await connectAsync({ connector: walletConnector })
      const connectedAddress = result.accounts[0]

      setWalletConnectTone('success')
      setWalletConnectMessage(
        connectedAddress
          ? `Operator wallet connected: ${connectedAddress}`
          : 'Operator wallet connected.',
      )
    } catch (error) {
      console.error('Operator wallet connection failed.', error)
      setWalletConnectTone('warning')
      setWalletConnectMessage('Wallet connection was cancelled or failed.')
    }
  }

  async function handleCopyReport() {
    await navigator.clipboard.writeText(report.markdown)
    trackProductEvent('report_exported', {
      action: report.action,
      exportMethod: 'copy',
      mode: modeLabel,
    })
    setCopyState('copied')
    window.setTimeout(() => setCopyState('idle'), 1600)
  }

  async function handleCopyActionPack() {
    const text =
      report.actionPack.commands.length > 0
        ? report.actionPack.commands
            .map((command) => `${command.label}: ${command.command}`)
            .join('\n')
        : report.actionPack.summary

    await navigator.clipboard.writeText(text)
    trackProductEvent('action_pack_exported', {
      action: report.action,
      exportMethod: 'copy',
      mode: modeLabel,
    })
    setActionCopyState('copied')
    window.setTimeout(() => setActionCopyState('idle'), 1600)
  }

  function handleDownloadReport() {
    const blob = new Blob([report.markdown], {
      type: 'text/markdown;charset=utf-8',
    })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')

    anchor.href = url
    anchor.download = 'arc-usdc-rebalancer-readiness-report.md'
    anchor.click()

    trackProductEvent('report_exported', {
      action: report.action,
      exportMethod: 'download',
      mode: modeLabel,
    })

    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  function handleDownloadActionPack() {
    const blob = new Blob(
      [
        JSON.stringify(
          {
            generatedAt: new Date().toISOString(),
            action: report.action,
            headline: report.headline,
            summary: report.summary,
            actionPack: report.actionPack,
            report: report.markdown,
          },
          null,
          2,
        ),
      ],
      { type: 'application/json;charset=utf-8' },
    )
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')

    anchor.href = url
    anchor.download = 'arc-usdc-rebalancer-action-pack.json'
    anchor.click()

    trackProductEvent('action_pack_exported', {
      action: report.action,
      exportMethod: 'download',
      mode: modeLabel,
    })

    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
  }

  async function handleRunLiveAction() {
    if (!canRunLiveAction) {
      setExecutionState('error')
      setExecutionMessage(liveExecutionLockedMessage)
      return
    }

    try {
      setExecutionState('running')
      setExecutionMessage('Waiting for operator authorization…')
      setExecutionResult(null)

      const requestId = crypto.randomUUID()
      const timestamp = Date.now()
      const origin = window.location.origin
      const intent = {
        action:
          report.action === 'top_up' || report.action === 'trim'
            ? report.action
            : undefined,
        amountUsdc: Number(report.actionPack.payload.amountUsdc),
        executorAddress: executorAddress ?? undefined,
        kind: 'execute' as const,
        operatorAddress: operatorAddress ?? '',
        origin,
        requestId,
        timestamp,
      }
      const signature = await signMessageAsync({
        message: buildLiveExecutionMessage(intent),
      })

      trackProductEvent('execution_requested', {
        action: report.action,
        mode: modeLabel,
      })
      setExecutionMessage('Submitting the authorized Arc Testnet request…')

      const requestBody = {
        action: report.action,
        amountUsdc: report.actionPack.payload.amountUsdc,
        executorAddress: executorAddress ?? undefined,
        operatorAddress,
        requestId,
        timestamp,
      }
      const response = await fetch('/api/treasury/execute', {
        body: JSON.stringify(requestBody),
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
          'x-operator-signature': signature,
        },
        method: 'POST',
      })
      const payload = (await response
        .json()
        .catch(() => ({}))) as TreasuryExecutionResponse

      if (!response.ok) {
        throw new Error(
          payload.error ?? `Treasury execution failed with ${response.status}.`,
        )
      }

      setExecutionResult(payload)
      setExecutionState('done')
      setExecutionMessage(
        payload.summary ?? 'Execution confirmed via the server signer.',
      )
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : 'Unknown treasury execution error.'
      setExecutionState('error')
      setExecutionMessage(`Execution failed: ${message}`)
    }
  }

  async function loadLivePolicy() {
    const result = await policyQuery.refetch()
    if (!result.data) {
      return
    }

    setPolicy(formatTreasuryPolicyFromUnits(result.data))
    setPolicySourceLabel('Live chain snapshot')
    policyHydratedRef.current = true
  }

  function setDemoBalance(
    nextBalance: number,
    scenario: 'below_minimum' | 'at_target' | 'above_target',
  ) {
    setBalance(Math.max(0, nextBalance))
    setPolicySourceLabel(
      policyHydratedRef.current ? 'Live chain snapshot' : 'Draft policy',
    )
    trackProductEvent('scenario_selected', {
      mode: modeLabel,
      scenario,
    })
  }

  useEffect(() => {
    trackProductEvent('dashboard_view')
  }, [])

  useEffect(() => {
    const decisionKey = `${report.action}:${balance}:${policySourceLabel}`
    if (lastDecisionEventRef.current === decisionKey) {
      return
    }

    lastDecisionEventRef.current = decisionKey
    trackProductEvent('decision_visible', {
      action: report.action,
      elapsedMs: Date.now() - dashboardStartedAtRef.current,
      mode: modeLabel,
      policySource: policySourceLabel,
    })
  }, [balance, modeLabel, policySourceLabel, report.action])

  const reportStatusTone =
    report.action === 'hold'
      ? 'success'
      : report.action === 'review'
        ? 'warning'
        : 'outline'
  const reportStatusLabel =
    report.action === 'hold'
      ? 'At target'
      : report.action === 'top_up'
        ? 'Below minimum'
        : report.action === 'trim'
          ? 'Above target'
          : 'Review'
  return (
    <main className="min-h-screen pb-16">
      <SiteHeader
        eyebrow="Readiness checker"
        title="Arc USDC Rebalancer"
        description="Get an auditable USDC treasury decision in about 30 seconds."
        ctaHref="/case-study"
        ctaLabel="Review proof"
      />

      <section className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-4 pb-8 pt-2 sm:px-6 lg:px-8">
        <div className="grid gap-6 lg:grid-cols-[1.06fr_0.94fr]">
          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge
                  variant="outline"
                  className="border-primary/25 bg-primary/10 text-primary"
                >
                  Report inputs
                </Badge>
                <Badge
                  variant={
                    policyQuery.isFetching
                      ? 'outline'
                      : policyIsLive
                        ? 'success'
                        : 'warning'
                  }
                >
                  {policyQuery.isFetching
                    ? 'Loading policy'
                    : policyIsLive
                      ? 'Policy ready'
                      : 'Policy preview'}
                </Badge>
              </div>
              <CardTitle className="text-xl">Check your treasury now</CardTitle>
              <CardDescription>
                Keep the draft values for preview mode, or load the onchain
                policy before switching to live operator mode.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="current-balance">Current balance</Label>
                <div className="relative">
                  <Input
                    id="current-balance"
                    inputMode="decimal"
                    value={balance}
                    onChange={(event) =>
                      setBalance(Number(event.target.value) || 0)
                    }
                    placeholder="475"
                    className="pr-20 text-lg"
                  />
                  <span className="pointer-events-none absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                    USDC
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setDemoBalance(
                      Math.max(0, policy.minThreshold - 25),
                      'below_minimum',
                    )
                  }
                >
                  Below minimum
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setDemoBalance(policy.targetBalance, 'at_target')
                  }
                >
                  At target
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() =>
                    setDemoBalance(
                      policy.targetBalance + policy.maxRebalanceAmount,
                      'above_target',
                    )
                  }
                >
                  Above target
                </Button>
              </div>

              <div className="rounded-2xl border border-primary/25 bg-primary/10 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={reportStatusTone}>
                    {report.action === 'review'
                      ? 'Review'
                      : report.action === 'hold'
                        ? 'Hold'
                        : report.action === 'top_up'
                          ? 'Top up'
                          : 'Trim'}
                  </Badge>
                  <span className="text-sm font-medium text-foreground">
                    {report.headline}
                  </span>
                </div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  {report.decisionBasis}
                </p>
              </div>

              <details className="rounded-2xl border border-white/10 bg-background/40 p-4">
                <summary className="cursor-pointer text-sm font-medium text-foreground">
                  Advanced policy inputs & live source
                </summary>
                <div className="mt-4 grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="min-threshold">Minimum threshold</Label>
                    <Input
                      id="min-threshold"
                      inputMode="decimal"
                      value={policy.minThreshold}
                      onChange={(event) =>
                        setPolicy((current) => ({
                          ...current,
                          minThreshold: Number(event.target.value) || 0,
                        }))
                      }
                      placeholder="100"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="target-balance">Target balance</Label>
                    <Input
                      id="target-balance"
                      inputMode="decimal"
                      value={policy.targetBalance}
                      onChange={(event) =>
                        setPolicy((current) => ({
                          ...current,
                          targetBalance: Number(event.target.value) || 0,
                        }))
                      }
                      placeholder="500"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="max-rebalance">Max rebalance amount</Label>
                    <Input
                      id="max-rebalance"
                      inputMode="decimal"
                      value={policy.maxRebalanceAmount}
                      onChange={(event) =>
                        setPolicy((current) => ({
                          ...current,
                          maxRebalanceAmount: Number(event.target.value) || 0,
                        }))
                      }
                      placeholder="200"
                    />
                  </div>
                </div>
                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/10 bg-card/60 p-3">
                  <div className="text-sm text-muted-foreground">
                    Policy band: {formatUsdc(policy.minThreshold)} /{' '}
                    {formatUsdc(policy.targetBalance)} /{' '}
                    {formatUsdc(policy.maxRebalanceAmount)} USDC
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    onClick={() => void loadLivePolicy()}
                    disabled={!contractAddress || policyQuery.isFetching}
                  >
                    <RefreshCcw className="h-4 w-4" />
                    {policyQuery.isFetching ? 'Loading…' : 'Load live policy'}
                  </Button>
                </div>
              </details>
            </CardContent>
          </Card>

          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                <CardTitle className="text-xl">Treasury decision</CardTitle>
              </div>
              <CardDescription>
                Copy this into chat, docs, or GitHub. It is the smallest useful
                output this site can produce.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={reportStatusTone}>
                    {report.action === 'review'
                      ? 'Review'
                      : report.action === 'hold'
                        ? 'Hold'
                        : 'Move funds'}
                  </Badge>
                  <Badge
                    variant="outline"
                    className="border-white/15 bg-white/5 text-foreground"
                  >
                    Readiness {report.readiness.passed}/{report.readiness.total}
                  </Badge>
                </div>
                <div className="mt-3 text-lg font-semibold text-foreground">
                  {report.headline}
                </div>
                <div className="mt-2 text-sm leading-6 text-muted-foreground">
                  {report.summary}
                </div>
                <div className="mt-3 rounded-xl border border-white/10 bg-card/70 p-3 text-sm text-foreground">
                  <span className="text-muted-foreground">
                    Decision basis:{' '}
                  </span>
                  {report.decisionBasis}
                </div>
              </div>

              <details className="rounded-2xl border border-white/10 bg-background/40 p-4">
                <summary className="cursor-pointer text-sm font-medium text-foreground">
                  View decision evidence
                </summary>
                <div className="mt-4 grid gap-3 sm:grid-cols-2">
                  {report.evidence.map((item) => (
                    <div
                      key={item.label}
                      className="rounded-2xl border border-white/10 bg-background/50 p-4"
                    >
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                        {item.label}
                      </div>
                      <div className="mt-2 break-all text-sm text-foreground">
                        {item.value}
                      </div>
                    </div>
                  ))}
                </div>
              </details>

              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Next steps
                </div>
                <div className="mt-2 space-y-2 text-sm leading-6 text-foreground">
                  {report.nextSteps.map((step) => (
                    <div key={step}>• {step}</div>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" onClick={() => void handleCopyReport()}>
                  <Copy className="h-4 w-4" />
                  {copyState === 'copied' ? 'Copied' : 'Copy report'}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={handleDownloadReport}
                >
                  <Download className="h-4 w-4" />
                  Download md
                </Button>
                <Button asChild variant="outline">
                  <a href="/notes">
                    <ArrowRight className="h-4 w-4" />
                    Notes
                  </a>
                </Button>
              </div>

              <details className="rounded-2xl border border-white/10 bg-background/40 p-4">
                <summary className="cursor-pointer text-sm font-medium text-foreground">
                  Preview markdown report
                </summary>
                <textarea
                  readOnly
                  value={report.markdown}
                  className="mt-3 min-h-[260px] w-full rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm leading-6 text-foreground shadow-sm focus-visible:outline-none"
                />
              </details>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/85 lg:col-span-2">
            <CardHeader>
              <div className="flex items-center gap-2">
                <CheckCircle2 className="h-5 w-5 text-primary" />
                <CardTitle className="text-xl">Action pack</CardTitle>
              </div>
              <CardDescription>
                This is the usable output: exact commands, an execution payload,
                and the report context in one place.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  What it does
                </div>
                <div className="mt-2 text-sm leading-6 text-foreground">
                  {report.actionPack.summary}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-primary/5 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Run status
                </div>
                <div className="mt-2 text-sm leading-6 text-foreground">
                  {actionPackStatusMessage}
                </div>
              </div>

              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Safety note
                </div>
                <p className="mt-2 text-sm leading-6 text-foreground">
                  These are manual operator command templates for testnet/demo
                  use. Do not paste real private keys into the browser. The site
                  does not collect private keys.
                </p>
              </div>

              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Commands
                </div>
                <textarea
                  readOnly
                  value={actionCommandsText || report.actionPack.summary}
                  className="mt-3 min-h-[220px] w-full rounded-2xl border border-border bg-background/70 px-4 py-3 font-mono text-sm leading-6 text-foreground shadow-sm focus-visible:outline-none"
                />
              </div>

              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Payload JSON
                </div>
                <textarea
                  readOnly
                  value={actionPayloadText}
                  className="mt-3 min-h-[220px] w-full rounded-2xl border border-border bg-background/70 px-4 py-3 font-mono text-sm leading-6 text-foreground shadow-sm focus-visible:outline-none"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  onClick={() => void handleCopyActionPack()}
                >
                  <Copy className="h-4 w-4" />
                  {actionCopyState === 'copied' ? 'Copied' : 'Copy action pack'}
                </Button>
                {showLiveExecutionControls ? (
                  <>
                    <Button
                      type="button"
                      onClick={() => void handleRunLiveAction()}
                      disabled={executionState === 'running'}
                    >
                      <ArrowRight className="h-4 w-4" />
                      {liveActionLabel}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={handleDownloadActionPack}
                    >
                      <Download className="h-4 w-4" />
                      Download JSON
                    </Button>
                  </>
                ) : null}
              </div>

              {!liveExecutionReady ? (
                <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="warning">Execution locked</Badge>
                    <div className="text-sm text-foreground">
                      Execution locked until operator wallet and live
                      dependencies are ready.
                    </div>
                  </div>
                  <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                    {liveExecutionBlockers.map((item) => (
                      <li key={item}>• {item}</li>
                    ))}
                  </ul>
                </div>
              ) : !showLiveExecutionControls ? (
                <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="success">No live transaction needed</Badge>
                    <div className="text-sm text-foreground">
                      {liveExecutionStatusMessage}
                    </div>
                  </div>
                </div>
              ) : null}

              {executionResult ? (
                <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    Latest execution
                  </div>
                  <div className="mt-2 text-sm leading-6 text-foreground">
                    {executionResult.summary}
                  </div>
                  <div className="mt-3 grid gap-2 sm:grid-cols-2">
                    {executionResult.txHashes?.approve ? (
                      <div className="rounded-xl border border-white/10 bg-card/70 p-3 text-xs text-muted-foreground">
                        Approve tx
                        <div className="mt-1 break-all text-sm text-foreground">
                          {executionResult.txHashes.approve}
                        </div>
                      </div>
                    ) : null}
                    <div className="rounded-xl border border-white/10 bg-card/70 p-3 text-xs text-muted-foreground">
                      Execute tx
                      <div className="mt-1 break-all text-sm text-foreground">
                        {executionResult.txHashes?.execute ?? '--'}
                      </div>
                    </div>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <Card className="border-white/10 bg-card/85">
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="border-primary/25 bg-primary/10 text-primary"
              >
                Operator readiness
              </Badge>
              <Badge variant={liveExecutionReady ? 'success' : 'warning'}>
                {liveExecutionReady ? 'Execution ready' : 'Execution locked'}
              </Badge>
              <Badge
                variant="outline"
                className="border-white/15 bg-white/5 text-foreground"
              >
                {reportStatusLabel}
              </Badge>
            </div>
            <CardTitle className="text-lg">
              Live execution stays optional and gated
            </CardTitle>
            <CardDescription>
              Preview mode remains useful without a wallet. These are the live
              gates the page checks before it will expose any signed execution
              path.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 md:grid-cols-5">
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Operator wallet
                </div>
                <div className="mt-2 text-sm text-foreground">
                  {operatorWalletConnected ? 'Connected' : 'Not connected'}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {operatorWalletConnected
                    ? operatorAddress
                    : 'Not connected in public preview.'}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Live policy
                </div>
                <div className="mt-2 text-sm text-foreground">
                  {policyIsLive ? 'Loaded' : 'Draft policy preview'}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {policyIsLive
                    ? 'Live onchain snapshot is active.'
                    : 'Preview stays on the draft policy band.'}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Circle wallet set
                </div>
                <div className="mt-2 text-sm text-foreground">
                  {circleReady ? 'Ready' : 'Missing'}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {circleStatusQuery.data?.walletSet?.id
                    ? circleStatusQuery.data.walletSet.id
                    : 'Wallet set not configured yet.'}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Executor
                </div>
                <div className="mt-2 text-sm text-foreground">
                  {executorAddress ? 'Configured' : 'Missing'}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {executorAddress ??
                    'Deploy or recheck the TreasuryExecutor first.'}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Execution
                </div>
                <div className="mt-2 text-sm text-foreground">
                  {liveExecutionReady ? 'Ready' : 'Locked'}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  {liveExecutionReady
                    ? 'All current live gates are satisfied.'
                    : 'Preview mode remains report-first.'}
                </div>
              </div>
            </div>

            <div className="flex flex-wrap gap-2">
              {walletConnector ? (
                <Button
                  type="button"
                  variant={operatorWalletConnected ? 'secondary' : 'outline'}
                  onClick={() => void handleConnectOperatorWallet()}
                  disabled={operatorWalletConnected || isConnecting}
                >
                  <Wallet className="h-4 w-4" />
                  {operatorWalletConnected
                    ? 'Operator wallet connected'
                    : isConnecting
                      ? 'Connecting…'
                      : 'Connect operator wallet'}
                </Button>
              ) : (
                <Button type="button" variant="outline" disabled>
                  <Wallet className="h-4 w-4" />
                  Operator wallet not connected in public preview
                </Button>
              )}

              <Button
                type="button"
                variant="outline"
                onClick={() => void loadLivePolicy()}
                disabled={!contractAddress || policyQuery.isFetching}
              >
                <RefreshCcw className="h-4 w-4" />
                {policyQuery.isFetching
                  ? 'Loading policy…'
                  : 'Load live policy'}
              </Button>
            </div>

            {walletConnectMessage ? (
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Wallet connection status
                </div>
                <div
                  className={`mt-2 text-sm leading-6 ${walletConnectTone === 'warning' ? 'text-foreground' : walletConnectTone === 'success' ? 'text-primary' : 'text-foreground'}`}
                >
                  {walletConnectMessage}
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Why execution is locked
              </div>
              <div className="mt-2 text-sm leading-6 text-foreground">
                {liveExecutionReady
                  ? 'Live execution is available, but the report still stays first.'
                  : liveExecutionStatusMessage}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="order-4 grid gap-4 md:grid-cols-4">
          <Card className="border-white/10 bg-card/85">
            <CardHeader className="space-y-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Policy source</CardTitle>
              <CardDescription>
                {policyIsLive
                  ? `Arc Testnet chain ${arcTestnetChainId}.`
                  : contractAddress
                    ? 'Draft policy preview until the live onchain snapshot is loaded.'
                    : 'Draft only until a policy address is set.'}
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className="border-white/10 bg-card/85">
            <CardHeader className="space-y-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Circle</CardTitle>
              <CardDescription>
                {circleStackSummary()} ·{' '}
                {circleStatusQuery.data?.notes?.length ?? 0} notes
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className="border-white/10 bg-card/85">
            <CardHeader className="space-y-2">
              <Wallet className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Executor</CardTitle>
              <CardDescription>
                {executorAddress
                  ? 'Configured for live execution.'
                  : 'Missing until an executor is deployed.'}
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className="border-white/10 bg-card/85">
            <CardHeader className="space-y-2">
              <BadgeCheck className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Agent identity</CardTitle>
              <CardDescription>
                #{arcAgentId.toString()} · {arcAgentValidationTag} · Arc
                Testnet-linked identity
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        <Card className="order-5 border-white/10 bg-card/85">
          <CardHeader>
            <CardTitle>Reference links</CardTitle>
            <CardDescription>
              Use these when you need to verify the live build or hand the
              report to someone else.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <a
              href="/dashboard"
              className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
            >
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Dashboard
              </div>
              <div className="mt-2 break-all text-sm text-foreground">
                Open the checker
              </div>
            </a>
            <a
              href={arcTestnetExplorerUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
            >
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Explorer
              </div>
              <div className="mt-2 break-all text-sm text-foreground">
                {arcTestnetExplorerUrl}
              </div>
            </a>
            <a
              href={arcTestnetRpcUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
            >
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                RPC
              </div>
              <div className="mt-2 break-all text-sm text-foreground">
                {arcTestnetRpcUrl}
              </div>
            </a>
            <a
              href="https://github.com/sin199/arc-usdc-rebalancer"
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
            >
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                GitHub
              </div>
              <div className="mt-2 break-all text-sm text-foreground">
                sin199/arc-usdc-rebalancer
              </div>
            </a>
            <a
              href="/notes"
              className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
            >
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Release notes
              </div>
              <div className="mt-2 break-all text-sm text-foreground">
                Open the written trail
              </div>
            </a>
            <a
              href="/case-study"
              className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
            >
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                Case study
              </div>
              <div className="mt-2 break-all text-sm text-foreground">
                Three-minute replay path
              </div>
            </a>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
