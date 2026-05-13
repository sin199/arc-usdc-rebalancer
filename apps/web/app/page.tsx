import Link from 'next/link'
import { ArrowRight, Activity, Bot, CircleDollarSign, Layers3, ShieldCheck, Wallet, Waves } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { arcTestnetChainId, arcTestnetExplorerUrl } from '@arc-usdc-rebalancer/shared'
import { arcTestnetRpcUrl } from '@/lib/treasury-policy'
import { arcAgentId, arcAgentValidationTag } from '@/lib/arc-agent'

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
    value: 'Public demo',
    detail: 'Dashboard + optional live operator',
  },
]

const liveTiles = [
  {
    icon: ShieldCheck,
    label: 'Treasury policy',
    value: 'Owner-gated',
    detail: 'Min, target, and max rebalance settings stay onchain for live mode.',
  },
  {
    icon: Wallet,
    label: 'Wallet layer',
    value: 'Injected wallet',
    detail: 'Connect only for live signing. Visitors can explore without a wallet.',
  },
  {
    icon: CircleDollarSign,
    label: 'Execution rail',
    value: 'Circle-ready',
    detail: 'Sample scenarios and the live rail share the same dashboard.',
  },
  {
    icon: Activity,
    label: 'Runtime',
    value: 'Visitor-first loop',
    detail: 'The agent summarizes, routes, and acts, even without a wallet connected.',
  },
]

const controlLoop = [
  {
    step: '01',
    title: 'Observe',
    description: 'Read wallet balance, policy bounds, agent identity, and chain state together.',
  },
  {
    step: '02',
    title: 'Brief',
    description: 'Turn the live signals into one recommended action instead of a wall of diagnostics.',
  },
  {
    step: '03',
    title: 'Execute',
    description: 'Use the dashboard to drive the owner-gated treasury path or the Circle control plane.',
  },
  {
    step: '04',
    title: 'Audit',
    description: 'Keep the chain hashes, status cards, and endpoints visible so the flow can be reviewed.',
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

export default function HomePage() {
  return (
    <main className="relative min-h-screen overflow-hidden pb-16">
      <div className="pointer-events-none absolute inset-0 bg-grid-fade opacity-[0.12] [background-size:24px_24px] [mask-image:linear-gradient(180deg,rgba(0,0,0,0.9),transparent_88%)]" />
      <div className="pointer-events-none absolute left-1/2 top-0 h-[34rem] w-[34rem] -translate-x-1/2 rounded-full bg-primary/10 blur-3xl" />
      <div className="pointer-events-none absolute right-0 top-32 h-80 w-80 rounded-full bg-accent/10 blur-3xl" />

      <div className="relative mx-auto max-w-7xl px-4 pt-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 rounded-full border border-white/10 bg-card/70 px-4 py-3 backdrop-blur md:flex-row md:items-center md:justify-between">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-sm font-semibold text-primary">
              AU
            </div>
            <div className="space-y-1">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="success">Arc Testnet</Badge>
                <Badge variant="outline" className="border-primary/25 bg-primary/10 text-primary">
                  Public demo available
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Arc USDC Rebalancer · agent {arcAgentId.toString()} · {arcAgentValidationTag} · visitors can try the
                demo without a wallet
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button asChild variant="outline">
              <Link href="/dashboard">
                Open demo
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
                A public treasury demo powered by a live agent.
              </h1>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                Visitors can inspect the policy, run the agent brief, and try sample treasury scenarios without
                connecting a wallet. If you want live signing, switch to operator mode from the dashboard.
              </p>
            </div>

            <div className="flex flex-col gap-3 sm:flex-row">
              <Button asChild size="lg">
                <Link href="/dashboard">
                  Launch demo
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
              <Button asChild size="lg" variant="outline">
                <a href="https://developers.circle.com/ai/skills" target="_blank" rel="noreferrer">
                  Circle AI skills
                </a>
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
                  Live surface
                </Badge>
                <span className="text-xs uppercase tracking-[0.24em] text-muted-foreground">Project status</span>
              </div>
              <CardTitle className="text-2xl">Operational snapshot</CardTitle>
              <CardDescription>
                The display page now stages the core system in a bento layout instead of a flat product card.
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
                The homepage is the public entry point. The dashboard is where visitors can try the agent, compare
                sample states, and optionally hand control to the live operator.
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/85 p-6">
            <CardHeader className="p-0">
              <CardTitle>Deployment facts</CardTitle>
              <CardDescription>Short facts that keep the public demo and live path legible at a glance.</CardDescription>
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
                Start with the demo, inspect the live signals, and switch to live mode only if you want signed
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
                A single glance should tell you what is public, what is live, and how far the project has already
                been wired.
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-6">
              <ul className="space-y-3 text-sm leading-6 text-muted-foreground">
                <li className="rounded-2xl border border-white/10 bg-background/45 p-4">
                  Show the Arc agent, treasury policy, and execution path together.
                </li>
                <li className="rounded-2xl border border-white/10 bg-background/45 p-4">
                  Let visitors explore without a wallet, then move into live operator mode if needed.
                </li>
                <li className="rounded-2xl border border-white/10 bg-background/45 p-4">
                  Make it obvious that the product is still evolving, not frozen as a finished demo.
                </li>
              </ul>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/85 p-6">
            <CardHeader className="p-0">
              <CardTitle>Open the working surface</CardTitle>
              <CardDescription>
                The homepage is the overview. The dashboard is where people actually try the demo.
              </CardDescription>
            </CardHeader>

            <CardContent className="pt-6">
              <Button asChild className="w-full" size="lg">
                <Link href="/dashboard">
                  Go to demo
                  <ArrowRight className="h-4 w-4" />
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  )
}
