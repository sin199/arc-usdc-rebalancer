import Link from 'next/link'
import { ArrowRight, CheckSquare, Clock3, ShieldCheck, Sparkles, Workflow, Wrench } from 'lucide-react'
import { SiteHeader } from '@/components/site-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { arcTestnetChainId, arcTestnetExplorerUrl } from '@arc-usdc-rebalancer/shared'
import { arcTestnetRpcUrl } from '@/lib/treasury-policy'

const features = [
  {
    icon: Workflow,
    title: 'Robot identity',
    description: 'The runtime now exposes mode, status, live snapshot data, and a clearer operator-facing surface.',
  },
  {
    icon: CheckSquare,
    title: 'Job center',
    description: 'Jobs are created from live Arc Testnet policy reads, then tracked through approvals, logs, and execution.',
  },
  {
    icon: ShieldCheck,
    title: 'Safety model',
    description: 'Safe defaults, explicit approval gates, allowlists, cooldowns, and testnet-only execution.',
  },
]

const workstreams = [
  {
    icon: Sparkles,
    title: 'Operator console refresh',
    status: 'Shipping now',
    detail: 'Tightening status readouts, empty states, and environment-aware banners so the dashboard feels alive.',
  },
  {
    icon: Wrench,
    title: 'Execution engine hardening',
    status: 'In progress',
    detail: 'Unifying the worker runtime with built-in deployment APIs to remove brittle external tunnel dependencies.',
  },
  {
    icon: Clock3,
    title: 'Review queue + audit trail',
    status: 'Next up',
    detail: 'Expanding approval history, logs, and lifecycle markers so each treasury action is reviewable.',
  },
]

const changelog = [
  'Built-in deployment API is now the default path for dashboard reads and job actions.',
  'Vercel production and preview envs were cleaned up to remove the stale external worker URL.',
  'Dashboard error states were narrowed so live runtime issues are easier to spot during iteration.',
]

const projectPulse = [
  {
    label: 'Milestone',
    value: 'v0.3 operator console',
  },
  {
    label: 'Focus',
    value: 'Runtime clarity over automation breadth',
  },
  {
    label: 'Next milestone',
    value: 'Review queue + execution telemetry',
  },
]

export default function HomePage() {
  return (
    <main className="min-h-screen">
      <SiteHeader
        eyebrow="Dev Preview"
        title="Arc Treasury Job Robot"
        description="An actively iterating treasury operations console for Arc Testnet."
        ctaHref="/dashboard"
        ctaLabel="Open live dashboard"
      />

      <section className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-16 pt-8 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
        <div className="space-y-8">
          <div className="space-y-5">
            <Badge variant="warning" className="w-fit">
              Alpha surface · shipping in public
            </Badge>
            <div className="space-y-4">
              <h2 className="max-w-2xl font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                A treasury robot console that now looks and behaves like a product still under active construction.
              </h2>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                The current release is focused on operator clarity: live job creation, embedded execution APIs,
                sharper status surfaces, and a clearer roadmap for what the robot can do next on Arc Testnet.
              </p>
            </div>
          </div>

          <div className="flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg">
              <Link href="/dashboard">
                Launch dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild size="lg" variant="outline">
              <a href="https://docs.arc.network" target="_blank" rel="noreferrer">
                Read Arc docs
              </a>
            </Button>
          </div>

          <Separator />

          <div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
            <Card className="border-primary/15 bg-card/85">
              <CardHeader>
                <Badge variant="outline" className="w-fit border-primary/25 bg-primary/10 text-primary">
                  Active workstreams
                </Badge>
                <CardTitle>What is being built right now</CardTitle>
                <CardDescription>This repo is being run like an internal product, not parked like a static demo.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {workstreams.map((item) => (
                  <div key={item.title} className="rounded-2xl border border-white/10 bg-background/50 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3">
                        <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                          <item.icon className="h-4 w-4" />
                        </div>
                        <div>
                          <div className="font-medium text-foreground">{item.title}</div>
                          <div className="text-sm text-muted-foreground">{item.detail}</div>
                        </div>
                      </div>
                      <Badge variant="outline">{item.status}</Badge>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <Badge variant="warning" className="w-fit">
                  Release notes
                </Badge>
                <CardTitle>Recent changes</CardTitle>
                <CardDescription>Short-form notes that make the project feel operated and updated.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3 text-sm text-muted-foreground">
                {changelog.map((item, index) => (
                  <div key={item} className="flex gap-3 rounded-2xl border border-white/10 bg-background/50 p-4">
                    <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-semibold text-primary">
                      {index + 1}
                    </div>
                    <div>{item}</div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-4 sm:grid-cols-3">
            {features.map((feature) => (
              <Card key={feature.title} className="h-full">
                <CardHeader>
                  <div className="mb-2 flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <feature.icon className="h-5 w-5" />
                  </div>
                  <CardTitle className="text-base">{feature.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <CardDescription>{feature.description}</CardDescription>
                </CardContent>
              </Card>
            ))}
          </div>
        </div>

        <div className="space-y-4">
          <Card className="border-primary/20 bg-card/90">
            <CardHeader>
              <Badge variant="outline" className="w-fit border-primary/25 bg-primary/10 text-primary">
                Development snapshot
              </Badge>
              <CardTitle>Arc Testnet / Build train</CardTitle>
              <CardDescription>Chain ID {arcTestnetChainId}, live policy reads, and an operator surface evolving in public.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="font-medium text-foreground">Build channel</div>
                <div className="mt-1">`codex/arc-treasury-job-robot` · production-linked dev preview</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="font-medium text-foreground">RPC endpoint</div>
                <div className="mt-1 break-all">{arcTestnetRpcUrl}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="font-medium text-foreground">Explorer</div>
                <div className="mt-1 break-all">{arcTestnetExplorerUrl}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="font-medium text-foreground">Current focus</div>
                <div className="mt-1">
                  Open the dashboard to inspect the runtime, create jobs, and track the parts of the operator workflow that are still being sharpened.
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-background/40">
            <CardHeader>
              <Badge variant="outline" className="w-fit">
                Project pulse
              </Badge>
              <CardTitle>Release train status</CardTitle>
              <CardDescription>Small signals that make the site read like a product someone is actively steering.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3 text-sm text-muted-foreground">
              {projectPulse.map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-card/70 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</div>
                  <div className="mt-2 text-foreground">{item.value}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  )
}
