import type { Metadata } from 'next'
import Image from 'next/image'
import Link from 'next/link'
import { ArrowRight, Activity, Bot, CircleDollarSign, Layers3, ShieldCheck, Wallet, Waves } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { arcTestnetChainId, arcTestnetExplorerUrl } from '@arc-usdc-rebalancer/shared'
import { arcTestnetRpcUrl } from '@/lib/treasury-policy'
import { arcAgentId, arcAgentValidationTag } from '@/lib/arc-agent'
import { projectReleaseNotes, projectTrailSummary } from '@/lib/project-trail'

export const metadata: Metadata = {
  title: 'Arc USDC Rebalancer · public demo',
  description:
    'A public Arc Testnet treasury demo with a live agent, a copyable readiness report, and a visible operator trail.',
  icons: {
    icon: '/icon.svg',
  },
}

const heroSignals = [
  {
    icon: Bot,
    label: 'Agent',
    value: `#${arcAgentId.toString()}`,
    detail: arcAgentValidationTag,
  },
  {
    icon: Waves,
    label: 'Network',
    value: 'Arc Testnet',
    detail: `Chain ID ${arcTestnetChainId}`,
  },
  {
    icon: Layers3,
    label: 'Surface',
    value: 'Readiness report',
    detail: 'Dashboard + copyable evidence pack',
  },
]

const liveTiles = [
  {
    icon: ShieldCheck,
    label: 'Treasury policy',
    value: 'Band + source',
    detail: 'Min, target, and max values become a plain report instead of hidden state.',
  },
  {
    icon: Wallet,
    label: 'Wallet layer',
    value: 'Optional',
    detail: 'Connect only if you want live signing. The report still works without it.',
  },
  {
    icon: CircleDollarSign,
    label: 'Execution rail',
    value: 'Review first',
    detail: 'The page tells you whether to hold, top up, trim, or stop and inspect wiring.',
  },
  {
    icon: Activity,
    label: 'Runtime',
    value: 'Copyable output',
    detail: 'The main output is a report you can paste into chat, docs, or GitHub.',
  },
]

const workingNotes = [
  'This is the current working build, not a polished launch page.',
  'The main job is to produce a readable treasury readiness report.',
  'Live signing remains available, but it should never be required to understand the result.',
  'The dashboard keeps a local maintenance log so updates can be written down as they happen.',
]

const controlLoop = [
  {
    step: '01',
    title: 'Open dashboard',
    description: 'Start from the report surface instead of hunting through the whole site.',
  },
  {
    step: '02',
    title: 'Generate report',
    description: 'Read the balance, policy bounds, and live readiness signals together.',
  },
  {
    step: '03',
    title: 'Copy outputs',
    description: 'Grab the markdown report or the action pack for chat, docs, or GitHub.',
  },
  {
    step: '04',
    title: 'Operator mode',
    description: 'Live execution stays behind the operator wallet and live dependencies.',
  },
]

const projectFacts = [
  {
    label: 'RPC endpoint',
    value: arcTestnetRpcUrl,
  },
  {
    label: 'Explorer',
    value: arcTestnetExplorerUrl,
  },
  {
    label: 'Dashboard',
    value: '/dashboard',
  },
  {
    label: 'Agent validation',
    value: arcAgentValidationTag,
  },
]

const recentReleaseNotes = projectReleaseNotes.slice(0, 3)

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden pb-16">
      <div className="pointer-events-none absolute inset-0 bg-grid-fade opacity-[0.12] [background-size:24px_24px] [mask-image:linear-gradient(180deg,rgba(0,0,0,0.9),transparent_88%)]" />
      <div className="pointer-events-none absolute left-1/2 top-0 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-32 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 rounded-full border border-white/10 bg-card/70 px-4 py-3 backdrop-blur md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <Image src="/logo.svg" alt="Arc USDC Rebalancer logo" width={44} height={44} className="h-11 w-11 shrink-0" />
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="success">Arc Testnet</Badge>
                <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">
                  Readiness report available
                </Badge>
                <Badge variant="outline" className="border-white/15 bg-white/5 text-foreground">
                  Operator brief ready
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Arc USDC Rebalancer · agent {arcAgentId.toString()} · {arcAgentValidationTag} · visitors can generate
                a report without a wallet · operator brief included
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/dashboard">
                Open checker
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild>
              <a href="https://docs.arc.network" target="_blank" rel="noreferrer">
                Arc docs
              </a>
            </Button>
          </div>
        </div>
      </div>

      <section className="relative mx-auto grid max-w-7xl gap-6 px-4 pb-8 pt-8 sm:px-6 lg:grid-cols-[1.12fr_0.88fr] lg:px-8">
        <Card className="relative overflow-hidden border-primary/20 bg-card/90 p-8 shadow-[0_30px_100px_-40px_rgba(16,185,129,0.55)] lg:p-10">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(16,185,129,0.18),transparent_30%),radial-gradient(circle_at_bottom_right,rgba(14,165,233,0.16),transparent_24%)]" />
          <div className="relative space-y-6">
            <div className="flex flex-wrap gap-2">
              <Badge variant="outline" className="border-white/15 bg-white/5 text-foreground">
                Working build
              </Badge>
              <Badge variant="success">Built for Arc treasury ops</Badge>
              <Badge variant="outline" className="border-white/15 bg-white/5 text-foreground">
                Wallet + policy + execution
              </Badge>
              <Badge variant="outline" className="border-white/15 bg-white/5 text-foreground">
                Operational brief live
              </Badge>
            </div>

            <div className="space-y-4">
              <h1 className="max-w-3xl font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl lg:text-6xl">
                A treasury readiness checker powered by a live agent.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                In 30 seconds, a visitor can open the dashboard, generate a readiness report, copy the markdown or
                action pack, and only move into operator mode if they explicitly want live execution.
              </p>
              <p className="text-sm text-muted-foreground">{projectTrailSummary.headline}</p>
              <p className="text-sm text-muted-foreground">Last hand-edited: {projectTrailSummary.lastReviewed}.</p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/dashboard">
                  Generate report
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/case-study">
                  Open case study
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/operator">
                  Operator brief
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <Link href="/notes">Release notes</Link>
              </Button>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              {heroSignals.map((signal) => (
                <div key={signal.label} className="rounded-2xl border border-white/10 bg-background/45 p-4">
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <signal.icon className="h-5 w-5" />
                  </div>
                  <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">{signal.label}</div>
                  <div className="mt-2 font-display text-xl font-semibold tracking-tight text-foreground">
                    {signal.value}
                  </div>
                  <div className="mt-1 text-sm text-muted-foreground">{signal.detail}</div>
                </div>
              ))}
            </div>
          </div>
        </Card>

        <div className="grid gap-4">
          <Card className="border-white/10 bg-card/85 p-6">
            <CardHeader className="space-y-2 p-0">
              <div className="flex items-center justify-between gap-4">
                <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">
                  Working build
                </Badge>
                <span className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Project status</span>
              </div>
              <CardTitle className="text-2xl">What is live right now</CardTitle>
              <CardDescription>
                The page stays close to the actual build: report first, live operator mode second, and the dashboard
                keeps a maintenance log so the site reads like something a person is still shaping.
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-6">
              <div className="grid gap-3 sm:grid-cols-2">
                {liveTiles.map((tile) => (
                  <div key={tile.label} className="rounded-2xl border border-white/10 bg-background/45 p-4">
                    <div className="flex items-center gap-3">
                      <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <tile.icon className="h-5 w-5" />
                      </div>
                      <div>
                        <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">{tile.label}</div>
                        <div className="mt-1 font-display text-lg font-semibold tracking-tight text-foreground">
                          {tile.value}
                        </div>
                      </div>
                    </div>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">{tile.detail}</p>
                  </div>
                ))}
              </div>

              <div className="mt-4 rounded-2xl border border-white/10 bg-primary/10 p-4 text-sm leading-6 text-foreground">
                The homepage is the public entry point. The robot brief explains what the installed agent does in this
                project. The case study explains the replay path. The dashboard is where visitors can generate the
                readiness report, compare sample states, and optionally hand control to the live operator.
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/85 p-6">
            <CardHeader className="p-0">
              <CardTitle>Deployment facts</CardTitle>
              <CardDescription>Short facts that keep the report path and live path legible at a glance.</CardDescription>
            </CardHeader>

            <CardContent className="pt-6">
              <div className="grid gap-3">
                {projectFacts.map((fact) => (
                  <div key={fact.label} className="rounded-2xl border border-white/10 bg-background/45 p-4">
                    <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">{fact.label}</div>
                    <div className="mt-2 break-all text-sm leading-6 text-foreground">{fact.value}</div>
                  </div>
                ))}
              </div>
              <div className="mt-4 rounded-2xl border border-white/10 bg-background/45 p-4">
                <div className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Working notes</div>
                <ul className="mt-3 space-y-2 text-sm leading-6 text-muted-foreground">
                  {workingNotes.map((note) => (
                    <li key={note}>• {note}</li>
                  ))}
                </ul>
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/85 p-6">
            <CardHeader className="p-0">
              <Badge variant="outline" className="w-fit border-primary/25 bg-primary/10 text-primary">
                Recent changes
              </Badge>
              <CardTitle className="mt-3 text-2xl">What changed most recently</CardTitle>
              <CardDescription>
                A compact trail of the latest edits, so the homepage looks like a maintained build instead of a frozen mockup.
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-6">
              <div className="space-y-3">
                {recentReleaseNotes.map((note) => (
                  <div key={`${note.date}-${note.title}`} className="rounded-2xl border border-white/10 bg-background/45 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <Badge variant="outline" className="border-white/15 bg-white/5 text-foreground">
                        {note.tag}
                      </Badge>
                      <span className="text-xs uppercase tracking-[0.24em] text-muted-foreground">{note.date}</span>
                    </div>
                    <div className="mt-3 font-display text-lg font-semibold tracking-tight text-foreground">
                      {note.title}
                    </div>
                    <p className="mt-2 text-sm leading-6 text-muted-foreground">{note.detail}</p>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </section>

      <section className="relative mx-auto grid max-w-7xl gap-6 px-4 sm:px-6 lg:grid-cols-[1.2fr_0.8fr] lg:px-8">
        <Card className="border-white/10 bg-card/85 p-6 sm:p-8">
            <CardHeader className="p-0">
              <Badge variant="outline" className="w-fit border-primary/25 bg-primary/10 text-primary">
                Control loop
              </Badge>
              <CardTitle className="mt-3 text-2xl sm:text-3xl">What visitors can do here</CardTitle>
              <CardDescription className="max-w-2xl">
                Start with the report, inspect the live signals, and switch to live mode only if you want signed
                execution.
              </CardDescription>
            </CardHeader>

          <CardContent className="pt-6">
            <div className="grid gap-4 md:grid-cols-2">
              {controlLoop.map((item) => (
                <div key={item.step} className="rounded-3xl border border-white/10 bg-background/45 p-5">
                  <div className="flex items-center justify-between gap-4">
                    <span className="font-display text-3xl font-semibold tracking-tight text-primary">{item.step}</span>
                    <div className="h-px flex-1 bg-gradient-to-r from-primary/40 to-transparent" />
                  </div>
                  <div className="mt-4 font-display text-xl font-semibold tracking-tight text-foreground">{item.title}</div>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">{item.description}</p>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6">
          <Card className="border-white/10 bg-card/85 p-6">
            <CardHeader className="p-0">
              <CardTitle>What this page is for</CardTitle>
              <CardDescription>
                A single glance should tell you what is public, what is live, and how far the report workflow has
                already been wired.
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-6">
              <ul className="space-y-3 text-sm leading-6 text-muted-foreground">
                <li className="rounded-2xl border border-white/10 bg-background/45 p-4">
                  Show the Arc agent, treasury policy, and report output together.
                </li>
                <li className="rounded-2xl border border-white/10 bg-background/45 p-4">
                  Let visitors explore without a wallet, then move into live operator mode if needed.
                </li>
                <li className="rounded-2xl border border-white/10 bg-background/45 p-4">
                  Keep the builder story legible from GitHub to the live checker and the review notes.
                </li>
                <li className="rounded-2xl border border-white/10 bg-background/45 p-4">
                  Surface the current work in progress without pretending the live operator path is automatic.
                </li>
                <li className="rounded-2xl border border-white/10 bg-background/45 p-4">
                  Use the robot brief as the shortest path for someone checking what the agent does here.
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/85 p-6">
            <CardHeader className="p-0">
              <CardTitle>Open the working surface</CardTitle>
              <CardDescription>
                The homepage is the overview. The case study explains the replay path. The dashboard is where people
                actually generate the report.
              </CardDescription>
            </CardHeader>

              <CardContent className="pt-6">
                <Button asChild className="w-full" size="lg">
                  <Link href="/dashboard">
                    Go to checker
                    <ArrowRight className="h-4 w-4" />
                  </Link>
                </Button>
                <Button asChild className="mt-3 w-full" size="lg" variant="outline">
                  <Link href="/operator">Open operator brief</Link>
                </Button>
                <Button asChild className="mt-3 w-full" size="lg" variant="outline">
                  <Link href="/case-study">Open case study</Link>
                </Button>
                <Button asChild className="mt-3 w-full" size="lg" variant="outline">
                  <Link href="/notes">Open release notes</Link>
                </Button>
              </CardContent>
            </Card>
        </div>
      </section>
    </main>
  )
}
