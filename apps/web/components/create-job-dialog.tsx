'use client'

import { useEffect, useRef, useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { isAddress } from 'viem'
import {
  formatRobotMode,
  formatTreasuryJobType,
  formatUsdc,
  type RobotExecutionMode,
  type RobotRuntimeState,
  type TreasuryJobRecord,
} from '@arc-usdc-rebalancer/shared'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { createJob, type CreateJobRequest } from '@/lib/execution-api'

type CreateJobDialogProps = {
  open: boolean
  initialJobType: CreateJobRequest['jobType']
  state: RobotRuntimeState | null
  onOpenChange: (open: boolean) => void
  onCreated: (job: TreasuryJobRecord) => void
}

type CreateJobFormState = {
  jobType: CreateJobRequest['jobType']
  amountUsdc: string
  destinationAddress: string
  executionMode: RobotExecutionMode
  notes: string
}

type FieldErrors = Partial<Record<keyof CreateJobFormState, string>>

const supportedJobTypes: CreateJobRequest['jobType'][] = [
  'rebalance',
  'wallet-top-up',
  'payout-batch',
  'treasury-sweep',
]

const supportedExecutionModes: RobotExecutionMode[] = ['dry-run', 'manual-approve', 'auto']

const fieldClassName =
  'flex h-11 w-full rounded-2xl border border-border bg-background/70 px-4 py-2 text-sm text-foreground shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background'

function buildDefaultAmount(jobType: CreateJobRequest['jobType'], state: RobotRuntimeState | null) {
  const snapshot = state?.snapshot
  const safetyMax = state?.safety.maxExecutionAmountUsdc ?? 100

  if (!snapshot) {
    return Math.max(1, safetyMax)
  }

  switch (jobType) {
    case 'rebalance': {
      const amount = Math.min(snapshot.treasuryBalanceUsdc - snapshot.policy.targetBalance, snapshot.policy.maxRebalanceAmount, safetyMax)
      return Math.max(1, amount > 0 ? amount : safetyMax)
    }
    case 'wallet-top-up': {
      const amount = Math.min(snapshot.policy.targetBalance - snapshot.treasuryBalanceUsdc, safetyMax)
      return Math.max(1, amount > 0 ? amount : safetyMax)
    }
    case 'payout-batch': {
      const batchTotal = snapshot.payoutRecipients.reduce((total, recipient) => total + recipient.amountUsdc, 0)
      return Math.max(1, batchTotal > 0 ? batchTotal : safetyMax)
    }
    case 'treasury-sweep': {
      const amount = Math.min(snapshot.treasuryBalanceUsdc - snapshot.policy.targetBalance, safetyMax)
      return Math.max(1, amount > 0 ? amount : safetyMax)
    }
  }

  return Math.max(1, safetyMax)
}

function buildDefaultDestination(jobType: CreateJobRequest['jobType'], state: RobotRuntimeState | null) {
  const snapshot = state?.snapshot
  const treasuryAddress = snapshot?.treasuryAddress ?? ''
  const rebalanceDestination = state?.safety.rebalanceDestinationAddress ?? state?.safety.destinationAllowlist[0] ?? treasuryAddress

  switch (jobType) {
    case 'rebalance':
      return rebalanceDestination || treasuryAddress || ''
    case 'wallet-top-up':
      return treasuryAddress || rebalanceDestination || ''
    case 'payout-batch':
      return snapshot?.payoutRecipients[0]?.address ?? rebalanceDestination ?? treasuryAddress ?? ''
    case 'treasury-sweep':
      return rebalanceDestination || treasuryAddress || ''
  }

  return ''
}

function buildDefaultExecutionMode(state: RobotRuntimeState | null): RobotExecutionMode {
  return state?.mode ?? 'dry-run'
}

function buildInitialFormState(jobType: CreateJobRequest['jobType'], state: RobotRuntimeState | null): CreateJobFormState {
  return {
    jobType,
    amountUsdc: String(buildDefaultAmount(jobType, state)),
    destinationAddress: buildDefaultDestination(jobType, state),
    executionMode: buildDefaultExecutionMode(state),
    notes: '',
  }
}

function validateForm(values: CreateJobFormState) {
  const errors: FieldErrors = {}
  const amountUsdc = Number(values.amountUsdc)
  const destinationAddress = values.destinationAddress.trim()

  if (!supportedJobTypes.includes(values.jobType)) {
    errors.jobType = 'Select a supported job type.'
  }

  if (!supportedExecutionModes.includes(values.executionMode)) {
    errors.executionMode = 'Select a supported execution mode.'
  }

  if (!Number.isFinite(amountUsdc) || amountUsdc <= 0) {
    errors.amountUsdc = 'Enter an amount greater than 0.'
  }

  if (!destinationAddress) {
    errors.destinationAddress = 'Enter a destination address.'
  } else if (!isAddress(destinationAddress)) {
    errors.destinationAddress = 'Enter a valid 0x address.'
  }

  return {
    errors,
    amountUsdc,
    destinationAddress,
    isValid: Object.keys(errors).length === 0,
  }
}

export function CreateJobDialog({ open, initialJobType, state, onOpenChange, onCreated }: CreateJobDialogProps) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<CreateJobFormState>(() => buildInitialFormState(initialJobType, state))
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({})
  const [submitError, setSubmitError] = useState<string | null>(null)
  const wasOpen = useRef(false)
  const previousInitialJobType = useRef<CreateJobRequest['jobType']>(initialJobType)

  useEffect(() => {
    if (!open) {
      wasOpen.current = false
      return
    }

    if (!wasOpen.current || previousInitialJobType.current !== initialJobType) {
      setForm(buildInitialFormState(initialJobType, state))
      setFieldErrors({})
      setSubmitError(null)
    }

    wasOpen.current = true
    previousInitialJobType.current = initialJobType
  }, [open, initialJobType, state])

  useEffect(() => {
    if (!open) {
      return
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onOpenChange(false)
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [open, onOpenChange])

  const createMutation = useMutation({
    mutationFn: createJob,
    onSuccess: async (nextState) => {
      const createdJob = nextState?.jobs[0]

      await queryClient.invalidateQueries({ queryKey: ['robot-status'] })
      await queryClient.invalidateQueries({ queryKey: ['robot-jobs'] })

      if (createdJob) {
        await queryClient.invalidateQueries({ queryKey: ['robot-job'] })
        onCreated(createdJob)
      }

      onOpenChange(false)
    },
    onError: (error) => {
      setSubmitError(error instanceof Error ? error.message : 'Unable to create the job.')
    },
  })

  if (!open) {
    return null
  }

  const canSubmit = !createMutation.isPending

  const requestMode = form.executionMode
  const executionModeWarning =
    requestMode === 'auto'
      ? state?.availability.autoEnabled
        ? null
        : 'Auto execution is currently unavailable; the worker will record the failure.'
      : requestMode === 'manual-approve'
        ? 'Manual approval will place the job into Pending Approvals.'
        : 'Dry run keeps the job in the Job Center without submitting a transaction.'

  function closeDialog() {
    onOpenChange(false)
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    const nextValidation = validateForm(form)
    setFieldErrors(nextValidation.errors)

    if (!nextValidation.isValid) {
      setSubmitError('Fix the highlighted fields and try again.')
      return
    }

    setSubmitError(null)

    createMutation.mutate({
      jobType: form.jobType,
      amountUsdc: nextValidation.amountUsdc,
      destinationAddress: nextValidation.destinationAddress,
      executionMode: form.executionMode,
      ...(form.notes.trim() ? { notes: form.notes.trim() } : {}),
    })
  }

  return (
    <div
      role="presentation"
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/70 px-4 py-6 backdrop-blur-sm"
      onClick={closeDialog}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-job-title"
        aria-describedby="create-job-description"
        className="relative w-full max-w-3xl overflow-hidden rounded-[2rem] border border-white/10 bg-card/95 shadow-[0_24px_100px_-40px_rgba(15,23,42,0.95)]"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div className="space-y-2">
            <Badge variant="outline" className="w-fit border-primary/25 bg-primary/10 text-primary">
              Create job
            </Badge>
            <div>
              <h2 id="create-job-title" className="font-display text-2xl font-semibold tracking-tight">
                Create a treasury job
              </h2>
              <p id="create-job-description" className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Use the dashboard form to create a real job record. Quick actions prefill the common treasury
                operations.
              </p>
            </div>
          </div>
          <Button variant="ghost" onClick={closeDialog}>
            Close
          </Button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-6 px-6 py-5">
          {submitError ? (
            <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-4 text-sm text-amber-100">
              {submitError}
            </div>
          ) : null}

          <div className="grid gap-4 md:grid-cols-2">
            <div className="space-y-2">
              <Label htmlFor="job-type">Job type</Label>
              <select
                id="job-type"
                className={fieldClassName}
                value={form.jobType}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    jobType: event.target.value as CreateJobRequest['jobType'],
                  }))
                }
              >
                {supportedJobTypes.map((jobType) => (
                  <option key={jobType} value={jobType}>
                    {formatTreasuryJobType(jobType)}
                  </option>
                ))}
              </select>
              {fieldErrors.jobType ? <p className="text-sm text-destructive">{fieldErrors.jobType}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="execution-mode">Execution mode</Label>
              <select
                id="execution-mode"
                className={fieldClassName}
                value={form.executionMode}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    executionMode: event.target.value as RobotExecutionMode,
                  }))
                }
              >
                {supportedExecutionModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {formatRobotMode(mode)}
                  </option>
                ))}
              </select>
              {fieldErrors.executionMode ? <p className="text-sm text-destructive">{fieldErrors.executionMode}</p> : null}
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-[1fr_1.2fr]">
            <div className="space-y-2">
              <Label htmlFor="amount-usdc">Amount</Label>
              <Input
                id="amount-usdc"
                type="number"
                min="0"
                step="0.01"
                inputMode="decimal"
                value={form.amountUsdc}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    amountUsdc: event.target.value,
                  }))
                }
                placeholder="100.00"
              />
              {fieldErrors.amountUsdc ? <p className="text-sm text-destructive">{fieldErrors.amountUsdc}</p> : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="destination-address">Destination address</Label>
              <Input
                id="destination-address"
                value={form.destinationAddress}
                onChange={(event) =>
                  setForm((current) => ({
                    ...current,
                    destinationAddress: event.target.value,
                  }))
                }
                placeholder="0x..."
              />
              {fieldErrors.destinationAddress ? (
                <p className="text-sm text-destructive">{fieldErrors.destinationAddress}</p>
              ) : null}
            </div>
          </div>

          <div className="space-y-2">
            <Label htmlFor="notes">Notes / rationale</Label>
            <textarea
              id="notes"
              rows={4}
              className={`${fieldClassName} min-h-[120px] py-3`}
              value={form.notes}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  notes: event.target.value,
                }))
              }
              placeholder="Why is this job being created?"
            />
          </div>

          <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm text-muted-foreground">
            <div className="flex flex-wrap items-center gap-2 text-foreground">
              <span className="font-medium">Preview</span>
              <Badge variant="outline">{formatTreasuryJobType(form.jobType)}</Badge>
              <Badge variant="outline">{formatRobotMode(form.executionMode)}</Badge>
              <Badge variant="outline">{formatUsdc(Number.isFinite(Number(form.amountUsdc)) ? Number(form.amountUsdc) : 0)} USDC</Badge>
            </div>
            <p className="mt-3 leading-6">
              {executionModeWarning}
              {state?.snapshot
                ? ` Current treasury balance is ${formatUsdc(state.snapshot.treasuryBalanceUsdc)} USDC.`
                : ' The dashboard will use the latest robot state if available.'}
            </p>
            {form.notes.trim() ? <p className="mt-2 text-foreground">{form.notes.trim()}</p> : null}
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/10 pt-4">
            <Button type="button" variant="outline" onClick={closeDialog}>
              Cancel
            </Button>
            <Button type="submit" disabled={!canSubmit}>
              {createMutation.isPending ? 'Creating job…' : 'Create job'}
            </Button>
          </div>
        </form>
      </div>
    </div>
  )
}
