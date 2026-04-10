'use client'

import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  ArrowRightLeft,
  Ban,
  CheckCircle2,
  RefreshCcw,
  ShieldAlert,
  ShieldCheck,
  TriangleAlert,
} from 'lucide-react'
import {
  formatExecutionKind,
  formatExecutionMode,
  formatExecutionStatus,
  formatUsdc,
  type ExecutionRunRecord,
  type ExecutionRuntimeState,
} from '@arc-usdc-rebalancer/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  approveExecutionRun,
  executionApiBaseUrl,
  fetchExecutionState,
  rejectExecutionRun,
  tickExecutionWorker,
} from '@/lib/execution-api'

function formatTimestamp(value?: string) {
  if (!value) {
    return '—'
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function statusVariant(status: ExecutionRunRecord['status']) {
  switch (status) {
    case 'confirmed':
      return 'success' as const
    case 'awaiting-approval':
    case 'failed':
    case 'rejected':
      return 'warning' as const
    case 'submitted':
      return 'default' as const
    case 'simulated':
      return 'secondary' as const
    case 'planned':
      return 'outline' as const
  }
}

function modeVariant(mode: ExecutionRuntimeState['mode']) {
  switch (mode) {
    case 'dry-run':
      return 'success' as const
    case 'manual-approve':
      return 'warning' as const
    case 'auto':
      return 'outline' as const
  }
}

function formatRunTitle(run: ExecutionRunRecord) {
  return `${formatExecutionKind(run.kind)} · ${formatUsdc(run.amountUsdc)} USDC`
}

function getExecutionDayKey(date: Date) {
  return date.toISOString().slice(0, 10)
}

function isCountedRun(run: ExecutionRunRecord) {
  return run.status === 'submitted' || run.status === 'confirmed'
}

export function ExecutionConsole() {
  const queryClient = useQueryClient()

  const stateQuery = useQuery({
    queryKey: ['execution-state', executionApiBaseUrl],
    queryFn: fetchExecutionState,
    refetchInterval: 15_000,
    enabled: Boolean(executionApiBaseUrl),
    staleTime: 5_000,
  })

  const approveMutation = useMutation({
    mutationFn: approveExecutionRun,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['execution-state', executionApiBaseUrl] })
    },
  })

  const rejectMutation = useMutation({
    mutationFn: rejectExecutionRun,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['execution-state', executionApiBaseUrl] })
    },
  })

  const tickMutation = useMutation({
    mutationFn: tickExecutionWorker,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['execution-state', executionApiBaseUrl] })
    },
  })

  const state = stateQuery.data
  const latestRun = state?.latestRuns[0]
  const dailySpent = useMemo(() => {
    if (!state) {
      return 0
    }

    const todayKey = getExecutionDayKey(new Date())

    return state.latestRuns.reduce((total, run) => {
      if (!isCountedRun(run)) {
        return total
      }

      const runTime = run.submittedAt ?? run.confirmedAt ?? run.createdAt

      if (getExecutionDayKey(new Date(runTime)) !== todayKey) {
        return total
      }

      return total + run.amountUsdc
    }, 0)
  }, [state])

  const dailyRemaining = state ? Math.max(0, state.safety.dailyNotionalCapUsdc - dailySpent) : 0

  const capabilityBadges = useMemo(() => {
    if (!state) {
      return []
    }

    return [
      {
        label: formatExecutionMode(state.mode),
        tone: modeVariant(state.mode),
      },
      {
        label: state.availability.circleExecutorAvailable ? 'Circle ready' : 'Circle disabled',
        tone: state.availability.circleExecutorAvailable ? ('success' as const) : ('warning' as const),
      },
      {
        label: state.availability.bridgeProviderAvailable ? 'Bridge ready' : 'Bridge disabled',
        tone: state.availability.bridgeProviderAvailable ? ('success' as const) : ('warning' as const),
      },
    ]
  }, [state])

  return (
    <Card>
      <CardHeader className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <CardTitle>Execution module</CardTitle>
            <CardDescription>Server-side worker state, scheduled evaluations, and manual approvals.</CardDescription>
          </div>
          <Button variant="outline" onClick={() => void tickMutation.mutateAsync()} disabled={!executionApiBaseUrl || tickMutation.isPending}>
            <RefreshCcw className="h-4 w-4" />
            {tickMutation.isPending ? 'Ticking…' : 'Tick worker'}
          </Button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {capabilityBadges.length > 0 ? (
            capabilityBadges.map((badge) => (
              <Badge key={badge.label} variant={badge.tone}>
                {badge.label}
              </Badge>
            ))
          ) : (
            <Badge variant="warning">Execution API not configured</Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="space-y-4 text-sm text-muted-foreground">
        {!executionApiBaseUrl ? (
          <div className="rounded-2xl border border-dashed border-white/10 bg-background/40 p-4">
            Set <span className="text-foreground">NEXT_PUBLIC_EXECUTION_API_URL</span> to connect the dashboard to the worker service.
          </div>
        ) : stateQuery.isLoading ? (
          <div className="rounded-2xl border border-white/10 bg-background/50 p-4">Loading worker state…</div>
        ) : stateQuery.isError ? (
          <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-amber-100">
            {stateQuery.error instanceof Error ? stateQuery.error.message : 'Unable to load execution state.'}
          </div>
        ) : state ? (
          <>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Last tick</div>
                <div className="mt-2 text-foreground">{formatTimestamp(state.lastTickAt)}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Treasury balance</div>
                <div className="mt-2 text-foreground">
                  {state.snapshot ? `${formatUsdc(state.snapshot.treasuryBalanceUsdc)} USDC` : '—'}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Balance source</div>
                <div className="mt-2 text-foreground">{state.snapshot?.balanceSource ?? '—'}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Daily cap remaining</div>
                <div className="mt-2 text-foreground">{formatUsdc(dailyRemaining)} USDC</div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Global pause</div>
                <div className="mt-2 text-foreground">{state.safety.globalPaused ? 'Paused' : 'Active'}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Policy pause</div>
                <div className="mt-2 text-foreground">{state.safety.policyPaused ? 'Paused' : 'Active'}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Emergency stop</div>
                <div className="mt-2 text-foreground">{state.safety.emergencyStop ? 'Engaged' : 'Clear'}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Cooldown</div>
                <div className="mt-2 text-foreground">{state.safety.cooldownMinutes} min</div>
              </div>
            </div>

            {state.availability.missingEnvVars.length > 0 ? (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                <div className="flex items-center gap-2 text-amber-200">
                  <TriangleAlert className="h-4 w-4" />
                  <span className="font-medium">Missing environment variables</span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {state.availability.missingEnvVars.map((missing) => (
                    <Badge key={missing} variant="warning">
                      {missing}
                    </Badge>
                  ))}
                </div>
              </div>
            ) : null}

            <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
              <div className="flex items-center gap-2 text-foreground">
                <ShieldCheck className="h-4 w-4 text-primary" />
                <span className="font-medium">Latest run</span>
              </div>
              {latestRun ? (
                <div className="mt-3 space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={statusVariant(latestRun.status)}>{formatExecutionStatus(latestRun.status)}</Badge>
                    <Badge variant="outline">{formatExecutionKind(latestRun.kind)}</Badge>
                    <Badge variant="outline">{formatExecutionMode(latestRun.mode)}</Badge>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-2xl border border-white/10 bg-card/70 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Reason</div>
                      <div className="mt-2 text-foreground">{latestRun.reason}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-card/70 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Trigger</div>
                      <div className="mt-2 text-foreground">{latestRun.triggerSource}</div>
                    </div>
                  </div>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="rounded-2xl border border-white/10 bg-card/70 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Amount</div>
                      <div className="mt-2 text-foreground">{formatUsdc(latestRun.amountUsdc)} USDC</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-card/70 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Last trigger</div>
                      <div className="mt-2 text-foreground">{formatTimestamp(latestRun.lastTriggerTime)}</div>
                    </div>
                    <div className="rounded-2xl border border-white/10 bg-card/70 p-4">
                      <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Executor</div>
                      <div className="mt-2 text-foreground">{latestRun.executor.name}</div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-white/10 bg-card/70 p-4">
                    <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Logs</div>
                      <div className="mt-2 space-y-1 text-sm text-muted-foreground">
                      {latestRun.logs.length > 0 ? (
                        latestRun.logs.map((line, index) => <div key={`${latestRun.id}-${index}`}>{line}</div>)
                      ) : (
                        <div>No logs recorded yet.</div>
                      )}
                    </div>
                  </div>
                  {latestRun.status === 'awaiting-approval' ? (
                    <div className="flex flex-wrap items-center gap-3">
                      <Button
                        onClick={() => void approveMutation.mutateAsync(latestRun.id)}
                        disabled={approveMutation.isPending}
                      >
                        <CheckCircle2 className="h-4 w-4" />
                        {approveMutation.isPending ? 'Approving…' : 'Approve'}
                      </Button>
                      <Button
                        variant="outline"
                        onClick={() => void rejectMutation.mutateAsync(latestRun.id)}
                        disabled={rejectMutation.isPending}
                      >
                        <Ban className="h-4 w-4" />
                        {rejectMutation.isPending ? 'Rejecting…' : 'Reject'}
                      </Button>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className="mt-3 text-sm text-muted-foreground">
                  No execution runs yet. The worker will generate runs when a balance or policy change crosses a safety
                  threshold.
                </div>
              )}
            </div>

            <div className="space-y-3">
              <div className="flex items-center gap-2 text-foreground">
                <ArrowRightLeft className="h-4 w-4 text-primary" />
                <span className="font-medium">Latest runs</span>
              </div>
              {state.latestRuns.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-white/10 bg-background/40 p-4 text-sm text-muted-foreground">
                  No stored runs yet.
                </div>
              ) : (
                state.latestRuns.slice(0, 5).map((run) => (
                  <div key={run.id} className="rounded-2xl border border-white/10 bg-background/50 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div className="space-y-1">
                        <div className="font-medium text-foreground">{formatRunTitle(run)}</div>
                        <div className="text-xs text-muted-foreground">{formatTimestamp(run.createdAt)}</div>
                      </div>
                      <Badge variant={statusVariant(run.status)}>{formatExecutionStatus(run.status)}</Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <Badge variant="outline">Trigger {run.triggerSource}</Badge>
                      <Badge variant="outline">{run.executor.name}</Badge>
                      {run.reasonCodes.slice(0, 3).map((reasonCode) => (
                        <Badge key={reasonCode} variant="secondary">
                          {reasonCode}
                        </Badge>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>

            <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm text-muted-foreground">
              {state.lastError ? (
                <div className="flex items-start gap-2 text-amber-300">
                  <ShieldAlert className="mt-0.5 h-4 w-4" />
                  <span>{state.lastError}</span>
                </div>
              ) : (
                'The worker keeps execution testnet-only, uses dry-run by default, and leaves auto execution disabled until credentials exist.'
              )}
            </div>
          </>
        ) : (
          <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
            The worker API returned no data yet.
          </div>
        )}
      </CardContent>
    </Card>
  )
}
