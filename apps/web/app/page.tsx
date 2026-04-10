import Link from 'next/link'
import { ArrowRight, CheckSquare, ShieldCheck, Workflow } from 'lucide-react'
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
    description: 'A simple treasury robot identity with supported job types, current mode, and status.',
  },
  {
    icon: CheckSquare,
    title: 'Job center',
    description: 'Jobs are created from live Arc Testnet policy reads, then tracked through approvals and execution.',
  },
  {
    icon: ShieldCheck,
    title: 'Safety model',
    description: 'Safe defaults, explicit approval gates, allowlists, cooldowns, and testnet-only execution.',
  },
]

export default function HomePage() {
  return (
    <main className="min-h-screen">
      <SiteHeader
        eyebrow="Arc Testnet"
        title="Arc Treasury Job Robot"
        description="A testnet-only treasury operations robot with job-first execution and safe defaults."
        ctaHref="/dashboard"
        ctaLabel="Open robot dashboard"
      />

      <section className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-16 pt-8 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
        <div className="space-y-8">
          <div className="space-y-5">
            <Badge variant="success" className="w-fit">
              Built for stablecoin treasury operations
            </Badge>
            <div className="space-y-4">
              <h2 className="max-w-2xl font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                A treasury job robot for Arc Testnet, not a chatbot and not a speculative bot.
              </h2>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                The robot reads the deployed TreasuryPolicy contract, plans treasury jobs from live state, tracks
                manual approvals, and stays safe by default in dry-run mode unless operators explicitly switch modes.
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
                Network snapshot
              </Badge>
              <CardTitle>Arc Testnet</CardTitle>
              <CardDescription>Chain ID {arcTestnetChainId} with native USDC and deterministic execution.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-muted-foreground">
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="font-medium text-foreground">RPC endpoint</div>
                <div className="mt-1 break-all">{arcTestnetRpcUrl}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="font-medium text-foreground">Explorer</div>
                <div className="mt-1 break-all">{arcTestnetExplorerUrl}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="font-medium text-foreground">Robot console</div>
                <div className="mt-1">
                  Open the dashboard to inspect the robot status, job center, approval queue, and execution timeline.
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  )
}
