'use client'

import { useEffect, useState } from 'react'
import { useAccount, useBalance, useConnect, useDisconnect, useSwitchChain } from 'wagmi'
import {
  Activity,
  ArrowRightLeft,
  CheckCircle2,
  Copy,
  ExternalLink,
  RefreshCcw,
  ShieldCheck,
  Wallet,
} from 'lucide-react'
import {
  ACTIVITY_LOG_STORAGE_KEY,
  arcTestnetChainId,
  arcTestnetExplorerUrl,
  arcTestnetRpcUrl,
  arcUsdcAddress,
  DEFAULT_TREASURY_POLICY,
  evaluatePolicy,
  formatUsdc,
  TREASURY_POLICY_STORAGE_KEY,
  truncateAddress,
  type ActivityEntry,
  type TreasuryPolicy,
  validatePolicy,
} from '@arc-usdc-rebalancer/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Separator } from '@/components/ui/separator'
import { SiteHeader } from '@/components/site-header'
import { readJson, writeJson } from '@/lib/storage'
import { arcTestnet } from '@/lib/wagmi'

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

export function TreasuryDashboard() {
  const { address, chainId, isConnected } = useAccount()
  const { connectors, connectAsync, isPending: isConnecting } = useConnect()
  const { disconnect } = useDisconnect()
  const { switchChainAsync, isPending: isSwitching } = useSwitchChain()
  const balanceQuery = useBalance({
    address,
    chainId: arcTestnet.id,
    query: {
      enabled: Boolean(address),
    },
  })

  const [policy, setPolicy] = useState<TreasuryPolicy>(DEFAULT_TREASURY_POLICY)
  const [savedPolicy, setSavedPolicy] = useState<TreasuryPolicy>(DEFAULT_TREASURY_POLICY)
  const [activity, setActivity] = useState<ActivityEntry[]>([])
  const [simulationMessage, setSimulationMessage] = useState<string>('Connect a wallet to simulate a rebalance.')
  const [lastValidationError, setLastValidationError] = useState<string | null>(null)

  useEffect(() => {
    const storedPolicy = readJson<TreasuryPolicy>(TREASURY_POLICY_STORAGE_KEY, DEFAULT_TREASURY_POLICY)
    const storedActivity = readJson<ActivityEntry[]>(ACTIVITY_LOG_STORAGE_KEY, [])
    const initialActivity =
      storedActivity.length > 0
        ? storedActivity
        : [
            {
              id: crypto.randomUUID(),
              title: 'Dashboard ready',
              detail: 'Local policy persistence is active and ready for Arc Testnet wallet connection.',
              createdAt: new Date().toISOString(),
              tone: 'neutral',
            } satisfies ActivityEntry,
          ]

    setPolicy(storedPolicy)
    setSavedPolicy(storedPolicy)
    setActivity(initialActivity)
    writeJson(ACTIVITY_LOG_STORAGE_KEY, initialActivity)
  }, [])

  const balanceValue = Number(balanceQuery.data?.formatted ?? 0)
  const evaluation = isConnected ? evaluatePolicy(balanceValue, policy) : null
  const hasUnsavedChanges =
    policy.minThreshold !== savedPolicy.minThreshold ||
    policy.targetBalance !== savedPolicy.targetBalance ||
    policy.maxRebalanceAmount !== savedPolicy.maxRebalanceAmount

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
        detail: 'Install a browser wallet such as MetaMask or Rabby, then refresh the page.',
        tone: 'warning',
      })
      return
    }

    try {
      await connectAsync({ connector: injectedConnector })
      pushActivity({
        title: 'Wallet connected',
        detail: `Connected through ${injectedConnector.name} and ready to check Arc Testnet.`,
        tone: 'success',
      })
      setSimulationMessage('Wallet connected. Run a policy check or simulate a rebalance.')
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
    setSimulationMessage('Wallet disconnected. Reconnect to resume balance checks.')
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

  function handleSavePolicy() {
    const validationError = validatePolicy(policy)
    setLastValidationError(validationError)

    if (validationError) {
      pushActivity({
        title: 'Policy save blocked',
        detail: validationError,
        tone: 'warning',
      })
      return
    }

    setSavedPolicy(policy)
    writeJson(TREASURY_POLICY_STORAGE_KEY, policy)
    pushActivity({
      title: 'Policy saved locally',
      detail: `Min ${formatUsdc(policy.minThreshold)} | Target ${formatUsdc(policy.targetBalance)} | Max rebalance ${formatUsdc(policy.maxRebalanceAmount)}`,
      tone: 'success',
    })
    setLastValidationError(null)
  }

  function handleSimulateRebalance() {
    if (!isConnected) {
      setSimulationMessage('Connect a wallet before simulating a rebalance.')
      return
    }

    const result = evaluatePolicy(balanceValue, policy)
    const summary =
      result.action === 'hold'
        ? 'No rebalance required.'
        : `${result.message} Contract call will later be routed to TreasuryPolicy on Arc Testnet.`

    setSimulationMessage(summary)
    pushActivity({
      title: 'Rebalance simulated',
      detail: `${result.message} Reason codes: ${result.reasonCodes.join(', ')}.`,
      tone: statusTone(result.status),
    })
  }

  const currentStatus = isConnected ? evaluation?.status ?? 'healthy' : null
  const walletSummary = isConnected && address ? truncateAddress(address) : 'No wallet connected'
  const policyLabel =
    currentStatus === 'below_min'
      ? 'Below threshold'
      : currentStatus === 'above_target'
        ? 'Above target'
        : currentStatus === 'healthy'
          ? 'Within policy'
          : 'Awaiting wallet'

  return (
    <main className="min-h-screen pb-16">
      <SiteHeader
        eyebrow="Treasury dashboard"
        title="Arc USDC Rebalancer"
        description="Monitor Arc Testnet USDC, save policy locally, and simulate treasury rebalances."
        ctaHref="/"
        ctaLabel="Back to landing"
      />

      <section className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 pb-8 sm:px-6 lg:px-8">
        <div className="grid gap-4 lg:grid-cols-4">
          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardDescription>Wallet</CardDescription>
                <CardTitle className="mt-1 text-lg">{walletSummary}</CardTitle>
              </div>
              <Wallet className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent className="flex items-center gap-2 text-sm text-muted-foreground">
              <Badge variant={isConnected ? 'success' : 'outline'}>{isConnected ? 'Connected' : 'Disconnected'}</Badge>
              {isConnected ? 'Ready for Arc Testnet actions.' : 'Connect a browser wallet to continue.'}
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardDescription>Network</CardDescription>
                <CardTitle className="mt-1 text-lg">Arc Testnet</CardTitle>
              </div>
              <ShieldCheck className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-2">
                <Badge variant={isConnected && chainId === arcTestnet.id ? 'success' : 'warning'}>
                  {isConnected && chainId === arcTestnet.id ? 'Detected' : 'Switch needed'}
                </Badge>
                <span className="text-sm text-muted-foreground">Chain ID {arcTestnetChainId}</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full"
                onClick={() => void handleSwitchChain()}
                disabled={!isConnected || isSwitching}
              >
                <RefreshCcw className="h-4 w-4" />
                {isSwitching ? 'Switching…' : 'Switch to Arc Testnet'}
              </Button>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardDescription>USDC balance</CardDescription>
                <CardTitle className="mt-1 text-lg">
                  {isConnected ? `${formatUsdc(balanceValue)} USDC` : 'Connect wallet'}
                </CardTitle>
              </div>
              <ArrowRightLeft className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent className="text-sm text-muted-foreground">
              Native Arc USDC balance for the connected address.
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-start justify-between space-y-0">
              <div>
                <CardDescription>Policy state</CardDescription>
                <CardTitle className="mt-1 text-lg">{policyLabel}</CardTitle>
              </div>
              <CheckCircle2 className="h-5 w-5 text-primary" />
            </CardHeader>
            <CardContent className="space-y-2 text-sm text-muted-foreground">
              <div>Min {formatUsdc(policy.minThreshold)} USDC</div>
              <div>Target {formatUsdc(policy.targetBalance)} USDC</div>
              <div>Max rebalance {formatUsdc(policy.maxRebalanceAmount)} USDC</div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.2fr_0.8fr]">
          <div className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle>Wallet controls</CardTitle>
                <CardDescription>Connect, switch network, and copy the active wallet address.</CardDescription>
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
                <CardTitle>Treasury policy</CardTitle>
                <CardDescription>Set the local treasury policy before you wire onchain persistence.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="space-y-2">
                    <Label htmlFor="minThreshold">Minimum threshold</Label>
                    <Input
                      id="minThreshold"
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
                    <Label htmlFor="targetBalance">Target balance</Label>
                    <Input
                      id="targetBalance"
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
                    <Label htmlFor="maxRebalanceAmount">Max rebalance amount</Label>
                    <Input
                      id="maxRebalanceAmount"
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

                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={handleSavePolicy}>Save policy locally</Button>
                  <Badge variant={hasUnsavedChanges ? 'warning' : 'success'}>
                    {hasUnsavedChanges ? 'Unsaved changes' : 'Policy saved'}
                  </Badge>
                </div>

                <Separator />

                <div className="text-sm text-muted-foreground">
                  {lastValidationError ? (
                    <span className="text-amber-300">{lastValidationError}</span>
                  ) : (
                    'Policy values are stored in browser local storage until contract sync is added.'
                  )}
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Rebalance simulation</CardTitle>
                <CardDescription>Use the current policy and balance to preview a treasury action.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Current balance</div>
                    <div className="mt-2 text-lg font-semibold text-foreground">
                      {isConnected ? `${formatUsdc(balanceValue)} USDC` : 'Connect wallet'}
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Action</div>
                    <div className="mt-2 text-lg font-semibold text-foreground">{evaluation?.action ?? 'Hold'}</div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Amount</div>
                    <div className="mt-2 text-lg font-semibold text-foreground">
                      {evaluation ? `${formatUsdc(evaluation.amount)} USDC` : '--'}
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <Button onClick={handleSimulateRebalance} disabled={!isConnected}>
                    <ArrowRightLeft className="h-4 w-4" />
                    Simulate rebalance
                  </Button>
                  <Badge variant={evaluation?.status === 'healthy' ? 'success' : 'warning'}>
                    {evaluation?.status ?? 'Awaiting wallet'}
                  </Badge>
                </div>

                <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm text-muted-foreground">
                  {simulationMessage}
                </div>

                {evaluation ? (
                  <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm text-muted-foreground">
                    <div className="font-medium text-foreground">Reason codes</div>
                    <div className="mt-2 flex flex-wrap gap-2">
                      {evaluation.reasonCodes.map((reasonCode) => (
                        <Badge key={reasonCode} variant="outline">
                          {reasonCode}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ) : null}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Contract readiness</CardTitle>
                <CardDescription>Prepared for TreasuryPolicy on Arc Testnet.</CardDescription>
              </CardHeader>
              <CardContent className="grid gap-4 sm:grid-cols-3">
                <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Owner-gated</div>
                  <div className="mt-2 text-sm text-foreground">TreasuryPolicy accepts updates only from the owner.</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Onchain mirror</div>
                  <div className="mt-2 text-sm text-foreground">Local policy mirrors the future contract call shape.</div>
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Deploy script</div>
                  <div className="mt-2 text-sm text-foreground">Foundry deploy script seeds policy values after broadcast.</div>
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
                <CardDescription>Recent wallet, policy, and simulation events.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {activity.length === 0 ? (
                  <div className="rounded-2xl border border-dashed border-white/10 bg-background/40 p-5 text-sm text-muted-foreground">
                    No activity yet. Connect a wallet or save policy to begin.
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
                <CardTitle>Deployment notes</CardTitle>
                <CardDescription>Keep the app simple for local use and Vercel deployment.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  Use the repository root for local work and set the Vercel project root directory to <span className="text-foreground">apps/web</span>.
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  Arc Testnet balance reads use the chain RPC directly, so no extra wallet env vars are required for the MVP.
                </div>
                <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  The Foundry package stays independent and can be compiled or deployed separately.
                </div>
              </CardContent>
            </Card>
          </div>
        </div>
      </section>
    </main>
  )
}
