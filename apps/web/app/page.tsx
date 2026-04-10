import Link from 'next/link'
import { ArrowRight, ShieldCheck, Wallet, Waves } from 'lucide-react'
import { SiteHeader } from '@/components/site-header'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Separator } from '@/components/ui/separator'
import { arcTestnetChainId, arcTestnetExplorerUrl } from '@arc-usdc-rebalancer/shared'
import { arcTestnetRpcUrl } from '@/lib/treasury-policy'

const features = [
  {
    icon: Wallet,
    title: 'Wallet first',
    description: 'Connect an injected wallet, read your address, and inspect the Arc USDC balance.',
  },
  {
    icon: ShieldCheck,
    title: 'Onchain policy',
    description: 'Read the deployed TreasuryPolicy contract, watch PolicyUpdated events, and submit owner-only updates.',
  },
  {
    icon: Waves,
    title: 'Execution module',
    description: 'Dry-run by default, manual approval when requested, and auto mode gated on credentials.',
  },
]

export default function HomePage() {
  return (
    <main className="min-h-screen">
      <SiteHeader
        eyebrow="Arc Testnet"
        title="Arc USDC Rebalancer v3"
        description="A testnet-only treasury execution module with safe defaults and explicit approval gates."
        ctaHref="/dashboard"
        ctaLabel="Open dashboard"
      />

      <section className="mx-auto grid w-full max-w-6xl gap-8 px-4 pb-16 pt-8 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8">
        <div className="space-y-8">
          <div className="space-y-5">
            <Badge variant="success" className="w-fit">
              Built for Arc Testnet treasury operations
            </Badge>
            <div className="space-y-4">
              <h2 className="max-w-2xl font-display text-4xl font-semibold tracking-tight text-balance sm:text-5xl">
                A stablecoin treasury execution module for Arc Testnet, not an alpha bot.
              </h2>
              <p className="max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg">
                Set a minimum threshold, a target balance, and a max rebalance amount. The dashboard reads the
                deployed TreasuryPolicy contract, simulates policy-driven execution on Arc Testnet, and only enables
                real execution when the worker credentials and mode allow it.
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
              <a href={`https://docs.arc.network`} target="_blank" rel="noreferrer">
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
              <CardDescription>Chain ID {arcTestnetChainId} with native USDC and deterministic finality.</CardDescription>
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
                <div className="font-medium text-foreground">Onchain policy</div>
                <div className="mt-1">
                  Treasury settings now come from the deployed TreasuryPolicy contract when the frontend address is set.
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  )
}
