'use client'

import { useEffect, useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  AlertTriangle,
  ArrowRightLeft,
  CheckCircle2,
  RefreshCcw,
  ShieldCheck,
  Slash,
  SquarePen,
  Workflow,
} from 'lucide-react'
import {
  arcTestnetChainId,
  formatRobotMode,
  formatRobotStatus,
  formatTreasuryJobStatus,
  formatTreasuryJobType,
  formatUsdc,
  type RobotRuntimeState,
  type TreasuryJobRecord,
} from '@arc-usdc-rebalancer/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { robotApiBaseUrl, approveJob, cancelJob, fetchJobById, fetchJobs, fetchRobotStatus, rejectJob, tickRobotWorker } from '@/lib/execution-api'

function formatTimestamp(value?: string) {
  if (!value) {
    return '—'
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value))
}

function formatCurrency(value?: number) {
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    return '—'
  }

  return `${formatUsdc(value)} USDC`
}

function jobStatusVariant(status: TreasuryJobRecord['status']) {
  switch (status) {
    case 'confirmed':
      return 'success' as const
    case 'awaiting-approval':
      return 'warning' as const
    case 'failed':
      return 'warning' as const
    case 'approved':
    case 'submitted':
      return 'default' as const
    case 'planned':
    case 'created':
      return 'outline' as const
    case 'rejected':
    case 'cancelled':
      return 'secondary' as const
  }
}

function modeVariant(mode: RobotRuntimeState['mode']) {
  switch (mode) {
    case 'dry-run':
      return 'success' as const
    case 'manual-approve':
      return 'warning' as const
    case 'auto':
      return 'outline' as const
  }
}

function robotStatusVariant(status: RobotRuntimeState['robot']['currentStatus']) {
  switch (status) {
    case 'ready':
      return 'success' as const
    case 'working':
      return 'default' as const
    case 'paused':
    case 'blocked':
      return 'warning' as const
  }
}

function riskVariant(level: TreasuryJobRecord['riskChecks'][number]['level']) {
  switch (level) {
    case 'pass':
      return 'success' as const
    case 'warn':
      return 'outline' as const
    case 'block':
      return 'warning' as const
  }
}

function isCountedJob(job: TreasuryJobRecord) {
  return job.status === 'submitted' || job.status === 'confirmed'
}

function jobParameterEntries(job: TreasuryJobRecord) {
  return Object.entries(job.parameters).filter(([, value]) => {
    if (value === undefined || value === null) {
      return false
    }

    if (Array.isArray(value)) {
      return value.length > 0
    }

    return true
  })
}

function formatParameterValue(key: string, value: unknown) {
  if (key === 'amountUsdc' || key === 'currentBalanceUsdc' || key === 'minThresholdUsdc' || key === 'targetBalanceUsdc') {
    return `${formatUsdc(Number(value))} USDC`
  }

  if (key === 'recipients' && Array.isArray(value)) {
    return `${value.length} recipient${value.length === 1 ? '' : 's'}`
  }

  if (typeof value === 'boolean') {
    return value ? 'Enabled' : 'Disabled'
  }

  if (typeof value === 'string' && value.startsWith('0x')) {
    return `${value.slice(0, 8)}…${value.slice(-6)}`
  }

  return String(value)
}

function timelineActorLabel(actor: TreasuryJobRecord['timeline'][number]['actor']) {
  switch (actor) {
    case 'operator':
      return 'Operator'
    case 'executor':
      return 'Executor'
    case 'system':
      return 'System'
    case 'robot':
      return 'Robot'
  }
}

export function TreasuryDashboard() {
  const queryClient = useQueryClient()
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null)

  const statusQuery = useQuery({
    queryKey: ['robot-status', robotApiBaseUrl],
    queryFn: fetchRobotStatus,
    refetchInterval: 15_000,
    enabled: Boolean(robotApiBaseUrl),
    staleTime: 5_000,
  })

  const jobsQuery = useQuery({
    queryKey: ['robot-jobs', robotApiBaseUrl],
    queryFn: fetchJobs,
    refetchInterval: 15_000,
    enabled: Boolean(robotApiBaseUrl),
    staleTime: 5_000,
  })

  const selectedJobQuery = useQuery({
    queryKey: ['robot-job', robotApiBaseUrl, selectedJobId],
    queryFn: () => (selectedJobId ? fetchJobById(selectedJobId) : null),
    refetchInterval: selectedJobId ? 15_000 : false,
    enabled: Boolean(robotApiBaseUrl && selectedJobId),
    staleTime: 5_000,
  })

  const tickMutation = useMutation({
    mutationFn: tickRobotWorker,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['robot-status', robotApiBaseUrl] })
      await queryClient.invalidateQueries({ queryKey: ['robot-jobs', robotApiBaseUrl] })
      if (selectedJobId) {
        await queryClient.invalidateQueries({ queryKey: ['robot-job', robotApiBaseUrl, selectedJobId] })
      }
    },
  })

  const approveMutation = useMutation({
    mutationFn: approveJob,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['robot-status', robotApiBaseUrl] })
      await queryClient.invalidateQueries({ queryKey: ['robot-jobs', robotApiBaseUrl] })
      if (selectedJobId) {
        await queryClient.invalidateQueries({ queryKey: ['robot-job', robotApiBaseUrl, selectedJobId] })
      }
    },
  })

  const rejectMutation = useMutation({
    mutationFn: rejectJob,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['robot-status', robotApiBaseUrl] })
      await queryClient.invalidateQueries({ queryKey: ['robot-jobs', robotApiBaseUrl] })
      if (selectedJobId) {
        await queryClient.invalidateQueries({ queryKey: ['robot-job', robotApiBaseUrl, selectedJobId] })
      }
    },
  })

  const cancelMutation = useMutation({
    mutationFn: cancelJob,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['robot-status', robotApiBaseUrl] })
      await queryClient.invalidateQueries({ queryKey: ['robot-jobs', robotApiBaseUrl] })
      if (selectedJobId) {
        await queryClient.invalidateQueries({ queryKey: ['robot-job', robotApiBaseUrl, selectedJobId] })
      }
    },
  })

  const state = statusQuery.data
  const jobs = useMemo(() => jobsQuery.data ?? state?.jobs ?? [], [jobsQuery.data, state?.jobs])
  const selectedJob = selectedJobQuery.data ?? jobs.find((job) => job.id === selectedJobId) ?? jobs[0] ?? null

  useEffect(() => {
    if (jobs.length === 0) {
      setSelectedJobId(null)
      return
    }

    const pendingApproval = jobs.find((job) => job.status === 'awaiting-approval')
    const nextSelection = pendingApproval ?? jobs[0]

    if (!selectedJobId || !jobs.some((job) => job.id === selectedJobId)) {
      setSelectedJobId(nextSelection.id)
    }
  }, [jobs, selectedJobId])

  const dailySpent = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10)

    return jobs.reduce((total, job) => {
      if (!isCountedJob(job)) {
        return total
      }

      const jobDay = new Date(job.updatedAt ?? job.createdAt).toISOString().slice(0, 10)

      if (jobDay !== todayKey) {
        return total
      }

      return total + job.amountUsdc
    }, 0)
  }, [jobs])

  const dailyRemaining = state ? Math.max(0, state.safety.dailyNotionalCapUsdc - dailySpent) : 0

  const timelineEntries = useMemo(() => {
    return jobs
      .flatMap((job) =>
        job.timeline.map((entry) => ({
          ...entry,
          job,
        })),
      )
      .sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime())
      .slice(0, 12)
  }, [jobs])

  const pendingApprovals = jobs.filter((job) => job.status === 'awaiting-approval')
  const latestJobs = jobs.slice(0, 6)
  const supportedJobTypes = state?.robot.supportedJobTypes ?? []

  const jobApiReady = Boolean(robotApiBaseUrl)

  return (
    <main className="min-h-screen">
      <section className="mx-auto w-full max-w-7xl px-4 pb-6 pt-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-6 rounded-[2rem] border border-white/10 bg-card/70 p-6 shadow-[0_24px_80px_-40px_rgba(15,23,42,0.85)] backdrop-blur">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
            <div className="space-y-3">
              <Badge variant="outline" className="w-fit border-primary/25 bg-primary/10 text-primary">
                Arc Testnet operations
              </Badge>
              <div className="space-y-2">
                <h1 className="font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                  Arc Treasury Job Robot
                </h1>
                <p className="max-w-3xl text-base leading-7 text-muted-foreground sm:text-lg">
                  A testnet-only treasury operations robot that plans, approves, executes, and reports jobs with
                  safe defaults, explicit approval gates, and a job-first interface.
                </p>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              {state ? (
                <>
                  <Badge variant={modeVariant(state.mode)}>{formatRobotMode(state.mode)}</Badge>
                  <Badge variant={robotStatusVariant(state.robot.currentStatus)}>
                    {formatRobotStatus(state.robot.currentStatus)}
                  </Badge>
                  <Badge variant="outline">Chain {arcTestnetChainId}</Badge>
                </>
              ) : (
                <Badge variant="warning">Robot API not connected</Badge>
              )}
              <Button
                variant="outline"
                onClick={() => void tickMutation.mutateAsync()}
                disabled={!jobApiReady || tickMutation.isPending}
              >
                <RefreshCcw className="h-4 w-4" />
                {tickMutation.isPending ? 'Evaluating…' : 'Evaluate now'}
              </Button>
            </div>
          </div>

          {!jobApiReady ? (
            <div className="rounded-2xl border border-dashed border-white/10 bg-background/40 p-4 text-sm text-muted-foreground">
              Set <span className="text-foreground">NEXT_PUBLIC_EXECUTION_API_URL</span> to point the dashboard at the
              public robot API.
            </div>
          ) : statusQuery.isLoading || jobsQuery.isLoading ? (
            <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm text-muted-foreground">
              Loading robot status and job history…
            </div>
          ) : statusQuery.isError || jobsQuery.isError ? (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
              Robot API requests failed. Check the worker URL and CORS access.
            </div>
          ) : (
            <div className="grid gap-6 lg:grid-cols-[1.15fr_0.85fr]">
              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Robot Status</CardTitle>
                    <CardDescription>Identity, mode, status, and live Arc Testnet snapshot.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm text-muted-foreground">
                    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                      <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Robot name</div>
                        <div className="mt-2 text-foreground">{state?.robot.name ?? 'Arc Treasury Job Robot'}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Current mode</div>
                        <div className="mt-2 text-foreground">{state ? formatRobotMode(state.mode) : '—'}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Current status</div>
                        <div className="mt-2 text-foreground">{state ? formatRobotStatus(state.robot.currentStatus) : '—'}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Last tick</div>
                        <div className="mt-2 text-foreground">{formatTimestamp(state?.lastTickAt)}</div>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Treasury balance</div>
                        <div className="mt-2 text-foreground">
                          {state?.snapshot ? `${formatUsdc(state.snapshot.treasuryBalanceUsdc)} USDC` : '—'}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Min / target / max</div>
                        <div className="mt-2 text-foreground">
                          {state?.snapshot
                            ? `${formatUsdc(state.snapshot.policy.minThreshold)} / ${formatUsdc(state.snapshot.policy.targetBalance)} / ${formatUsdc(state.snapshot.policy.maxRebalanceAmount)}`
                            : '—'}
                        </div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Daily cap remaining</div>
                        <div className="mt-2 text-foreground">{formatUsdc(dailyRemaining)} USDC</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      {supportedJobTypes.map((type) => (
                        <Badge key={type} variant="secondary">
                          {formatTreasuryJobType(type)}
                        </Badge>
                      ))}
                    </div>

                    <div className="rounded-2xl border border-white/10 bg-card/70 p-4">
                      <div className="flex items-center gap-2 text-foreground">
                        <Workflow className="h-4 w-4 text-primary" />
                        <span className="font-medium">Robot identity</span>
                      </div>
                      <div className="mt-3 grid gap-3 sm:grid-cols-2">
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Onchain agent</div>
                          <div className="mt-2 text-foreground">{state?.robot.onchainAgentIdentity ?? 'Placeholder only'}</div>
                        </div>
                        <div>
                          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">API endpoint</div>
                          <div className="mt-2 break-all text-foreground">{robotApiBaseUrl || 'Not configured'}</div>
                        </div>
                      </div>
                    </div>

                    {state?.lastError ? (
                      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                        <div className="flex items-center gap-2 text-amber-200">
                          <AlertTriangle className="h-4 w-4" />
                          <span className="font-medium">Last error</span>
                        </div>
                        <div className="mt-2 text-foreground">{state.lastError}</div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <CardTitle>Job Center</CardTitle>
                        <CardDescription>Latest job records created by the robot on its scheduled checks.</CardDescription>
                      </div>
                      <div className="flex items-center gap-2">
                        <Badge variant="outline">{jobs.length} jobs</Badge>
                        <Badge variant="outline">{pendingApprovals.length} pending approvals</Badge>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    {latestJobs.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-background/40 p-4 text-sm text-muted-foreground">
                        No jobs yet. Click evaluate to make the robot read the live policy and produce a new plan.
                      </div>
                    ) : (
                      latestJobs.map((job) => (
                        <button
                          key={job.id}
                          type="button"
                          onClick={() => setSelectedJobId(job.id)}
                          className={`w-full rounded-2xl border p-4 text-left transition ${
                            selectedJobId === job.id
                              ? 'border-primary/30 bg-primary/5'
                              : 'border-white/10 bg-background/50 hover:bg-card/80'
                          }`}
                        >
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div className="space-y-1">
                              <div className="font-medium text-foreground">
                                {formatTreasuryJobType(job.type)} · {formatUsdc(job.amountUsdc)} USDC
                              </div>
                              <div className="text-xs text-muted-foreground">{formatTimestamp(job.createdAt)}</div>
                            </div>
                            <Badge variant={jobStatusVariant(job.status)}>{formatTreasuryJobStatus(job.status)}</Badge>
                          </div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            <Badge variant="outline">Mode {formatRobotMode(job.executionMode)}</Badge>
                            <Badge variant="outline">Trigger {job.triggerSource}</Badge>
                            {job.riskChecks.slice(0, 3).map((check) => (
                              <Badge key={check.code} variant={riskVariant(check.level)}>
                                {check.code}
                              </Badge>
                            ))}
                          </div>
                        </button>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Execution Timeline</CardTitle>
                    <CardDescription>Chronological job lifecycle events from the robot’s internal log.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {timelineEntries.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-background/40 p-4 text-sm text-muted-foreground">
                        No lifecycle events yet.
                      </div>
                    ) : (
                      timelineEntries.map((entry) => (
                        <div key={`${entry.job.id}-${entry.at}-${entry.status}`} className="rounded-2xl border border-white/10 bg-background/50 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="space-y-1">
                              <div className="font-medium text-foreground">
                                {formatTreasuryJobType(entry.job.type)} · {formatTreasuryJobStatus(entry.status)}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                {formatTimestamp(entry.at)} · {timelineActorLabel(entry.actor)}
                              </div>
                            </div>
                            <Badge variant={jobStatusVariant(entry.status)}>{formatTreasuryJobStatus(entry.status)}</Badge>
                          </div>
                          <div className="mt-2 text-sm text-muted-foreground">{entry.message}</div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>
              </div>

              <div className="space-y-6">
                <Card>
                  <CardHeader>
                    <CardTitle>Safety Controls</CardTitle>
                    <CardDescription>Hard stops, caps, allowlists, and credential gates.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm text-muted-foreground">
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Global pause</div>
                        <div className="mt-2 text-foreground">{state?.safety.globalPaused ? 'Paused' : 'Active'}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Policy pause</div>
                        <div className="mt-2 text-foreground">{state?.safety.policyPaused ? 'Paused' : 'Active'}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Emergency stop</div>
                        <div className="mt-2 text-foreground">{state?.safety.emergencyStop ? 'Engaged' : 'Clear'}</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Cooldown</div>
                        <div className="mt-2 text-foreground">{state?.safety.cooldownMinutes ?? '—'} min</div>
                      </div>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Daily spent</div>
                        <div className="mt-2 text-foreground">{formatUsdc(dailySpent)} USDC</div>
                      </div>
                      <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                        <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Daily remaining</div>
                        <div className="mt-2 text-foreground">{formatUsdc(dailyRemaining)} USDC</div>
                      </div>
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <Badge variant={state?.availability.circleExecutorAvailable ? 'success' : 'warning'}>
                        {state?.availability.circleExecutorAvailable ? 'Circle configured' : 'Circle disabled'}
                      </Badge>
                      <Badge variant={state?.availability.bridgeProviderAvailable ? 'success' : 'warning'}>
                        {state?.availability.bridgeProviderAvailable ? 'Bridge configured' : 'Bridge disabled'}
                      </Badge>
                      <Badge variant={state?.availability.autoEnabled ? 'success' : 'warning'}>
                        {state?.availability.autoEnabled ? 'Auto eligible' : 'Auto gated'}
                      </Badge>
                    </div>

                    {state?.availability.missingEnvVars.length ? (
                      <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4">
                        <div className="flex items-center gap-2 text-amber-200">
                          <AlertTriangle className="h-4 w-4" />
                          <span className="font-medium">Missing environment variables</span>
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          {state.availability.missingEnvVars.map((envVar) => (
                            <Badge key={envVar} variant="warning">
                              {envVar}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    {state?.snapshot ? (
                      <div className="rounded-2xl border border-white/10 bg-card/70 p-4">
                        <div className="flex items-center gap-2 text-foreground">
                          <ShieldCheck className="h-4 w-4 text-primary" />
                          <span className="font-medium">Live policy snapshot</span>
                        </div>
                        <div className="mt-3 grid gap-3 sm:grid-cols-3">
                          <div>
                            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Policy</div>
                            <div className="mt-2 break-all text-foreground">{state.snapshot.policyAddress}</div>
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Treasury</div>
                            <div className="mt-2 break-all text-foreground">{state.snapshot.treasuryAddress}</div>
                          </div>
                          <div>
                            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Balance source</div>
                            <div className="mt-2 text-foreground">{state.snapshot.balanceSource}</div>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Pending Approvals</CardTitle>
                    <CardDescription>Jobs waiting for an explicit operator decision.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-3">
                    {pendingApprovals.length === 0 ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-background/40 p-4 text-sm text-muted-foreground">
                        No jobs are waiting for approval right now.
                      </div>
                    ) : (
                      pendingApprovals.map((job) => (
                        <div key={job.id} className="rounded-2xl border border-white/10 bg-background/50 p-4">
                          <div className="flex flex-wrap items-center justify-between gap-3">
                            <div className="space-y-1">
                              <div className="font-medium text-foreground">{formatTreasuryJobType(job.type)}</div>
                              <div className="text-xs text-muted-foreground">{job.requestedAction.summary}</div>
                            </div>
                            <Badge variant={jobStatusVariant(job.status)}>{formatTreasuryJobStatus(job.status)}</Badge>
                          </div>
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            <Button
                              onClick={() => void approveMutation.mutateAsync(job.id)}
                              disabled={approveMutation.isPending}
                            >
                              <CheckCircle2 className="h-4 w-4" />
                              Approve
                            </Button>
                            <Button
                              variant="outline"
                              onClick={() => void rejectMutation.mutateAsync(job.id)}
                              disabled={rejectMutation.isPending}
                            >
                              <Slash className="h-4 w-4" />
                              Reject
                            </Button>
                          </div>
                          <div className="mt-3">
                            <Button
                              variant="ghost"
                              className="px-0 text-sm text-muted-foreground hover:bg-transparent hover:text-foreground"
                              onClick={() => setSelectedJobId(job.id)}
                            >
                              View details
                            </Button>
                          </div>
                        </div>
                      ))
                    )}
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <div>
                        <CardTitle>Job Detail Panel</CardTitle>
                        <CardDescription>Selected job, risk checks, parameters, logs, and execution outcome.</CardDescription>
                      </div>
                      {selectedJob ? (
                        <Badge variant={jobStatusVariant(selectedJob.status)}>
                          {formatTreasuryJobStatus(selectedJob.status)}
                        </Badge>
                      ) : null}
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4 text-sm text-muted-foreground">
                    {!selectedJob ? (
                      <div className="rounded-2xl border border-dashed border-white/10 bg-background/40 p-4">
                        Select a job to inspect its timeline, risk checks, and execution result.
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant="outline">{formatTreasuryJobType(selectedJob.type)}</Badge>
                          <Badge variant="outline">Mode {formatRobotMode(selectedJob.executionMode)}</Badge>
                          <Badge variant="outline">Trigger {selectedJob.triggerSource}</Badge>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Requested action</div>
                            <div className="mt-2 text-foreground">{selectedJob.requestedAction.summary}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Approval reason</div>
                            <div className="mt-2 text-foreground">{selectedJob.approvalReason}</div>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-3">
                          <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Amount</div>
                            <div className="mt-2 text-foreground">{formatCurrency(selectedJob.amountUsdc)}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Created</div>
                            <div className="mt-2 text-foreground">{formatTimestamp(selectedJob.createdAt)}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Updated</div>
                            <div className="mt-2 text-foreground">{formatTimestamp(selectedJob.updatedAt)}</div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Risk checks</div>
                          <div className="mt-3 flex flex-wrap gap-2">
                            {selectedJob.riskChecks.map((check) => (
                              <Badge key={check.code} variant={riskVariant(check.level)}>
                                {check.code}
                              </Badge>
                            ))}
                          </div>
                          <div className="mt-4 space-y-2">
                            {selectedJob.riskChecks.map((check) => (
                              <div key={`${selectedJob.id}-${check.code}`} className="rounded-2xl border border-white/10 bg-card/70 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="font-medium text-foreground">{check.label}</div>
                                  <Badge variant={riskVariant(check.level)}>{check.level}</Badge>
                                </div>
                                <div className="mt-1 text-sm text-muted-foreground">{check.detail}</div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Parameters</div>
                          <div className="mt-3 grid gap-3 sm:grid-cols-2">
                            {jobParameterEntries(selectedJob).map(([key, value]) => (
                              <div key={key} className="rounded-2xl border border-white/10 bg-card/70 p-3">
                                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{key}</div>
                                <div className="mt-2 break-words text-foreground">{formatParameterValue(key, value)}</div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Result</div>
                            <div className="mt-2 text-foreground">{selectedJob.result ?? '—'}</div>
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Failure reason</div>
                            <div className="mt-2 text-foreground">{selectedJob.failureReason ?? '—'}</div>
                          </div>
                        </div>

                        <div className="grid gap-3 sm:grid-cols-2">
                          <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Transaction hash</div>
                            <div className="mt-2 break-all text-foreground">{selectedJob.txHash ?? '—'}</div>
                            {selectedJob.txUrl ? (
                              <a
                                href={selectedJob.txUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="mt-2 inline-flex items-center gap-2 text-sm text-primary hover:underline"
                              >
                                View on explorer
                                <ArrowRightLeft className="h-3.5 w-3.5" />
                              </a>
                            ) : null}
                          </div>
                          <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                            <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Executor</div>
                            <div className="mt-2 text-foreground">{selectedJob.executor.name}</div>
                            <div className="mt-1 text-sm text-muted-foreground">
                              {selectedJob.executor.enabled ? 'Enabled' : 'Disabled'}
                            </div>
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Logs</div>
                          <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                            {selectedJob.logs.length > 0 ? (
                              selectedJob.logs.map((line, index) => <div key={`${selectedJob.id}-${index}`}>{line}</div>)
                            ) : (
                              <div>No logs recorded yet.</div>
                            )}
                          </div>
                        </div>

                        <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                          <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Timeline</div>
                          <div className="mt-3 space-y-2">
                            {selectedJob.timeline.map((entry) => (
                              <div key={`${selectedJob.id}-${entry.status}-${entry.at}`} className="rounded-2xl border border-white/10 bg-card/70 p-3">
                                <div className="flex flex-wrap items-center justify-between gap-2">
                                  <div className="font-medium text-foreground">{formatTreasuryJobStatus(entry.status)}</div>
                                  <div className="text-xs text-muted-foreground">
                                    {formatTimestamp(entry.at)} · {timelineActorLabel(entry.actor)}
                                  </div>
                                </div>
                                <div className="mt-1 text-sm text-muted-foreground">{entry.message}</div>
                              </div>
                            ))}
                          </div>
                        </div>

                        <div className="flex flex-wrap gap-3">
                          {selectedJob.status === 'awaiting-approval' ? (
                            <>
                              <Button
                                onClick={() => void approveMutation.mutateAsync(selectedJob.id)}
                                disabled={approveMutation.isPending}
                              >
                                <CheckCircle2 className="h-4 w-4" />
                                Approve
                              </Button>
                              <Button
                                variant="outline"
                                onClick={() => void rejectMutation.mutateAsync(selectedJob.id)}
                                disabled={rejectMutation.isPending}
                              >
                                <Slash className="h-4 w-4" />
                                Reject
                              </Button>
                            </>
                          ) : null}
                          {selectedJob.status === 'created' ||
                          selectedJob.status === 'planned' ||
                          selectedJob.status === 'awaiting-approval' ||
                          selectedJob.status === 'approved' ? (
                            <Button
                              variant="ghost"
                              onClick={() => void cancelMutation.mutateAsync(selectedJob.id)}
                              disabled={cancelMutation.isPending}
                            >
                              <SquarePen className="h-4 w-4" />
                              Cancel
                            </Button>
                          ) : null}
                        </div>
                      </>
                    )}
                  </CardContent>
                </Card>
              </div>
            </div>
          )}
        </div>
      </section>
    </main>
  )
}
