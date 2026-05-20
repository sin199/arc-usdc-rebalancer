'use client'

import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useReadContract } from 'wagmi'
import {
  ArrowRight,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  RefreshCcw,
  ShieldCheck,
  TriangleAlert,
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
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { SiteHeader } from '@/components/site-header'
import { arcAgentId, arcAgentValidationTag } from '@/lib/arc-agent'
import { buildReadinessReport } from '@/lib/readiness-report'
import { treasuryExecutorAddressConfig } from '@/lib/treasury-executor'
import { arcTestnetRpcUrl, formatTreasuryPolicyFromUnits, treasuryPolicyAddressConfig } from '@/lib/treasury-policy'
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

const initialPolicy = DEFAULT_TREASURY_POLICY

export function ReadinessChecker() {
  const contractAddress = treasuryPolicyAddressConfig.address
  const executorAddress = treasuryExecutorAddressConfig.address
  const [balance, setBalance] = useState(Math.max(0, initialPolicy.targetBalance - 25))
  const [policy, setPolicy] = useState(initialPolicy)
  const [policySourceLabel, setPolicySourceLabel] = useState<'Draft policy' | 'Live chain snapshot'>('Draft policy')
  const [copyState, setCopyState] = useState<'idle' | 'copied'>('idle')
  const policyHydratedRef = useRef(false)

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
  const circleSummary = circleReady ? 'Readiness complete' : 'Readiness incomplete'
  const liveMode = Boolean(contractAddress && circleReady && executorAddress)
  const modeLabel = liveMode ? 'Live operator mode' : 'Preview mode'
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
    liveMode,
    modeLabel,
    policy,
    policySourceLabel,
    walletSetId: circleStatusQuery.data?.walletSet?.id,
  })

  async function handleCopyReport() {
    await navigator.clipboard.writeText(report.markdown)
    setCopyState('copied')
    window.setTimeout(() => setCopyState('idle'), 1600)
  }

  function handleDownloadReport() {
    const blob = new Blob([report.markdown], { type: 'text/markdown;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')

    anchor.href = url
    anchor.download = 'arc-usdc-rebalancer-readiness-report.md'
    anchor.click()

    window.setTimeout(() => URL.revokeObjectURL(url), 2000)
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

  function setDemoBalance(nextBalance: number) {
    setBalance(Math.max(0, nextBalance))
    setPolicySourceLabel(policyHydratedRef.current ? 'Live chain snapshot' : 'Draft policy')
  }

  const reportStatusTone = report.action === 'hold' ? 'success' : report.action === 'review' ? 'warning' : 'outline'

  return (
    <main className="min-h-screen pb-16">
      <SiteHeader
        eyebrow="Readiness checker"
        title="Arc USDC Rebalancer"
        description="Generate a copyable treasury readiness report from the current balance, policy band, Circle status, and executor state."
        ctaHref="/notes"
        ctaLabel="Open notes"
      />

      <section className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-4 pb-8 pt-2 sm:px-6 lg:px-8">
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-white/15 bg-white/5 text-foreground">
                Working build
              </Badge>
              <Badge variant={reportStatusTone}>{report.action === 'review' ? 'Needs review' : report.action === 'hold' ? 'Ready' : 'Action suggested'}</Badge>
              <Badge variant="outline" className="border-white/15 bg-white/5 text-foreground">
                {modeLabel}
              </Badge>
            </div>
            <CardTitle className="text-3xl">One input surface for treasury decisions</CardTitle>
            <CardDescription className="max-w-3xl">
              Paste the current balance, load the policy if you have it onchain, and the page returns one concise
              report you can copy into chat, docs, or GitHub.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Current balance</div>
              <div className="mt-2 text-sm text-foreground">{formatUsdc(balance)} USDC</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Policy source</div>
              <div className="mt-2 text-sm text-foreground">{policySourceLabel}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Circle</div>
              <div className="mt-2 text-sm text-foreground">{circleSummary}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Executor</div>
              <div className="mt-2 text-sm text-foreground">{executorAddress ? 'Configured' : 'Missing'}</div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1.06fr_0.94fr]">
          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">
                  Report inputs
                </Badge>
                <Badge variant={policyQuery.isFetching ? 'outline' : contractAddress ? 'success' : 'outline'}>
                  {policyQuery.isFetching ? 'Loading policy' : contractAddress ? 'Policy ready' : 'Policy preview'}
                </Badge>
              </div>
              <CardTitle className="text-xl">Set the state you want to inspect</CardTitle>
              <CardDescription>
                Use the live chain policy when it is available, or keep the draft values and generate a preview report.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-5">
              <div className="grid gap-4 sm:grid-cols-4">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="current-balance">Current balance</Label>
                  <Input
                    id="current-balance"
                    inputMode="decimal"
                    value={balance}
                    onChange={(event) => setBalance(Number(event.target.value) || 0)}
                    placeholder="475"
                  />
                </div>
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
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
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
                <div className="space-y-2">
                  <Label>Policy band</Label>
                  <div className="rounded-2xl border border-white/10 bg-background/50 px-4 py-3 text-sm text-foreground">
                    {formatUsdc(policy.minThreshold)} / {formatUsdc(policy.targetBalance)} / {formatUsdc(
                      policy.maxRebalanceAmount,
                    )} USDC
                  </div>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" variant="outline" onClick={() => setDemoBalance(Math.max(0, policy.minThreshold - 25))}>
                  Below minimum
                </Button>
                <Button type="button" variant="outline" onClick={() => setDemoBalance(policy.targetBalance)}>
                  At target
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setDemoBalance(policy.targetBalance + policy.maxRebalanceAmount)}
                >
                  Above target
                </Button>
                <Button type="button" variant="secondary" onClick={() => void loadLivePolicy()} disabled={!contractAddress || policyQuery.isFetching}>
                  <RefreshCcw className="h-4 w-4" />
                  {policyQuery.isFetching ? 'Loading…' : 'Load live policy'}
                </Button>
              </div>

              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Why this matters</div>
                <p className="mt-2 text-sm leading-6 text-muted-foreground">
                  The report should answer one question quickly: hold, top up, trim, or review. The rest of the page is
                  just evidence.
                </p>
              </div>
            </CardContent>
          </Card>

          <Card className="border-primary/20 bg-primary/5">
            <CardHeader>
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                <CardTitle className="text-xl">Readiness report</CardTitle>
              </div>
              <CardDescription>
                Copy this into chat, docs, or GitHub. It is the smallest useful output this site can produce.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={reportStatusTone}>{report.action === 'review' ? 'Review' : report.action === 'hold' ? 'Hold' : 'Move funds'}</Badge>
                  <Badge variant="outline" className="border-white/15 bg-white/5 text-foreground">
                    {(report.confidence * 100).toFixed(0)}% confidence
                  </Badge>
                </div>
                <div className="mt-3 text-lg font-semibold text-foreground">{report.headline}</div>
                <div className="mt-2 text-sm leading-6 text-muted-foreground">{report.summary}</div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2">
                {report.evidence.map((item) => (
                  <div key={item.label} className="rounded-2xl border border-white/10 bg-background/50 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</div>
                    <div className="mt-2 text-sm text-foreground">{item.value}</div>
                  </div>
                ))}
              </div>

              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Next steps</div>
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
                <Button type="button" variant="outline" onClick={handleDownloadReport}>
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

              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Markdown preview</div>
                <textarea
                  readOnly
                  value={report.markdown}
                  className="mt-3 min-h-[260px] w-full rounded-2xl border border-border bg-background/70 px-4 py-3 text-sm leading-6 text-foreground shadow-sm focus-visible:outline-none"
                />
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <Card className="border-white/10 bg-card/85">
            <CardHeader className="space-y-2">
              <ShieldCheck className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Policy</CardTitle>
              <CardDescription>
                {contractAddress ? `Arc Testnet chain ${arcTestnetChainId}.` : 'Draft only until a policy address is set.'}
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className="border-white/10 bg-card/85">
            <CardHeader className="space-y-2">
              <CheckCircle2 className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Circle</CardTitle>
              <CardDescription>
                {circleStackSummary()} · {circleStatusQuery.data?.notes?.length ?? 0} notes
              </CardDescription>
            </CardHeader>
          </Card>
          <Card className="border-white/10 bg-card/85">
            <CardHeader className="space-y-2">
              <Wallet className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Executor</CardTitle>
              <CardDescription>{executorAddress ? 'Configured for live execution.' : 'Missing until an executor is deployed.'}</CardDescription>
            </CardHeader>
          </Card>
          <Card className="border-white/10 bg-card/85">
            <CardHeader className="space-y-2">
              <TriangleAlert className="h-5 w-5 text-primary" />
              <CardTitle className="text-base">Agent</CardTitle>
              <CardDescription>
                #{arcAgentId.toString()} · {arcAgentValidationTag} · Arc Testnet-linked identity
              </CardDescription>
            </CardHeader>
          </Card>
        </div>

        <Card className="border-white/10 bg-card/85">
          <CardHeader>
            <CardTitle>Reference links</CardTitle>
            <CardDescription>Use these when you need to verify the live build or hand the report to someone else.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <a
              href="/dashboard"
              className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
            >
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Dashboard</div>
              <div className="mt-2 break-all text-sm text-foreground">Open the checker</div>
            </a>
            <a
              href={arcTestnetExplorerUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
            >
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Explorer</div>
              <div className="mt-2 break-all text-sm text-foreground">{arcTestnetExplorerUrl}</div>
            </a>
            <a
              href={arcTestnetRpcUrl}
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
            >
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">RPC</div>
              <div className="mt-2 break-all text-sm text-foreground">{arcTestnetRpcUrl}</div>
            </a>
            <a
              href="https://github.com/sin199/arc-usdc-rebalancer"
              target="_blank"
              rel="noreferrer"
              className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
            >
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">GitHub</div>
              <div className="mt-2 break-all text-sm text-foreground">sin199/arc-usdc-rebalancer</div>
            </a>
            <a
              href="/notes"
              className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
            >
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Release notes</div>
              <div className="mt-2 break-all text-sm text-foreground">Open the written trail</div>
            </a>
            <a
              href="/case-study"
              className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
            >
              <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Case study</div>
              <div className="mt-2 break-all text-sm text-foreground">Three-minute replay path</div>
            </a>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
