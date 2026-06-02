import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  BadgeCheck,
  ExternalLink,
  FileText,
  ShieldCheck,
  Sparkles,
  Wallet,
  Waves,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SiteHeader } from '@/components/site-header'
import { architectProof } from '@/lib/architect-proof'
import { arcAgentId, arcAgentValidationTag } from '@/lib/arc-agent'

export const metadata: Metadata = {
  title: 'Arc USDC Rebalancer · architect proof',
  description:
    'A single Arc Architects review page with deployment facts, Arcscan links, current proof status, and safety boundaries.',
}

const whatIBuilt = [
  'A public Arc Testnet treasury demo with a report-first readiness checker.',
  'A compact operator brief that explains how the installed robot is used in the project.',
  'Optional live execution that remains gated behind the wallet, policy, Circle, and executor checks.',
  'A submission path that makes the proof easy to review without implying official Arc endorsement.',
]

const whyItMatters = [
  'It turns the treasury flow into something a reviewer can inspect in one pass.',
  'It separates preview mode from live execution instead of mixing the two together.',
  'It keeps the Arc Testnet policy, agent identity, executor, and report trail visible in the same build.',
  'It gives the community a concrete builder contribution instead of only a claim.',
]

const visitorFlow = [
  'Open the homepage and read the 30-second visitor path.',
  'Open the dashboard without a wallet and generate a readiness report.',
  'Copy the markdown report or action pack from preview mode.',
  'Compare the At target, Below minimum, and Above target scenarios.',
]

const operatorFlow = [
  'Connect an operator wallet only when live signing is intentionally needed.',
  'Load the live policy snapshot, inspect the operator readiness panel, and confirm the execution boundary.',
  'Keep Circle wallet-set readiness visible for live crosschain execution.',
  'Use Run top-up or Run trim only when all existing live gates are ready.',
]

const surfaceItems = [
  'Arc Testnet chain state',
  'TreasuryPolicy reads and owner-gated updates',
  'TreasuryExecutor for USDC movement',
  'Arc agent identity and validation status',
  'Circle developer-controlled wallet and Gateway readiness',
  'Public demo mode and report-first action pack',
]

const demoLinks = [
  {
    label: 'Homepage',
    href: architectProof.productionUrl,
    value: architectProof.productionUrl,
  },
  {
    label: 'Dashboard',
    href: `${architectProof.productionUrl}/dashboard`,
    value: `${architectProof.productionUrl}/dashboard`,
  },
  {
    label: 'Architect proof',
    href: `${architectProof.productionUrl}/architects`,
    value: `${architectProof.productionUrl}/architects`,
  },
  {
    label: 'Operator brief',
    href: `${architectProof.productionUrl}/operator`,
    value: `${architectProof.productionUrl}/operator`,
  },
  {
    label: 'Case study',
    href: `${architectProof.productionUrl}/case-study`,
    value: `${architectProof.productionUrl}/case-study`,
  },
  {
    label: 'Release notes',
    href: `${architectProof.productionUrl}/notes`,
    value: `${architectProof.productionUrl}/notes`,
  },
  {
    label: 'GitHub repo',
    href: architectProof.githubRepoUrl,
    value: 'sin199/arc-usdc-rebalancer',
  },
  {
    label: 'Arc House post',
    href: architectProof.arcHousePostUrl,
    value: 'Circle Agent Stack Builder Feedback',
  },
]

export default function ArchitectsPage() {
  return (
    <main className="min-h-screen pb-16">
      <SiteHeader
        eyebrow="Architect proof"
        title="Arc USDC Rebalancer"
        description="One page for Arc Architects review: deployment facts, proof status, and the boundaries that stay visible."
        ctaHref="/dashboard"
        ctaLabel="Open dashboard"
      />

      <section className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-4 pb-8 pt-2 sm:px-6 lg:px-8">
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-white/15 bg-white/5 text-foreground">
                Verified Arc Testnet demo
              </Badge>
              <Badge variant="success">Report first</Badge>
              <Badge variant="outline" className="border-white/15 bg-white/5 text-foreground">
                Optional live execution
              </Badge>
              <Badge variant="outline" className="border-white/15 bg-white/5 text-foreground">
                No official Arc endorsement
              </Badge>
            </div>
            <CardTitle className="text-3xl">A completed builder contribution for Arc review</CardTitle>
            <CardDescription className="max-w-3xl text-base leading-7">
              The site proves a report-first treasury flow on Arc Testnet. Visitors can review the evidence without a
              wallet, and live execution only appears when the operator wallet, live policy, Circle wallet set, and
              executor configuration are all ready.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            {demoLinks.map((item) => (
              <a
                key={item.label}
                href={item.href}
                target={item.href.startsWith('http') ? '_blank' : undefined}
                rel={item.href.startsWith('http') ? 'noreferrer' : undefined}
                className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
              >
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</div>
                <div className="mt-2 break-all text-sm leading-6 text-foreground">{item.value}</div>
                <div className="mt-2 inline-flex items-center gap-1 text-xs text-primary">
                  Open
                  <ExternalLink className="h-3.5 w-3.5" />
                </div>
              </a>
            ))}
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1.04fr_0.96fr]">
          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <CardTitle>What I built</CardTitle>
              </div>
              <CardDescription>The surface is intentionally short and readable.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {whatIBuilt.map((line) => (
                <div key={line} className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm leading-6 text-foreground">
                  {line}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <div className="flex items-center gap-2">
                <BadgeCheck className="h-5 w-5 text-primary" />
                <CardTitle>Why it matters for Arc</CardTitle>
              </div>
              <CardDescription>The reviewer should be able to see the contribution without guessing the angle.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {whyItMatters.map((line) => (
                <div key={line} className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm leading-6 text-foreground">
                  {line}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Waves className="h-5 w-5 text-primary" />
                <CardTitle>Arc surfaces used</CardTitle>
              </div>
              <CardDescription>The proof references the same live surfaces the site exposes in the demo.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {surfaceItems.map((item) => (
                <Badge key={item} variant="outline" className="border-white/15 bg-white/5 text-foreground">
                  {item}
                </Badge>
              ))}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Wallet className="h-5 w-5 text-primary" />
                <CardTitle>Visitor and operator flow</CardTitle>
              </div>
              <CardDescription>Preview mode stays useful without a wallet. Live mode is explicit.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Public visitor flow</div>
                <div className="mt-3 space-y-2 text-sm leading-6 text-foreground">
                  {visitorFlow.map((line) => (
                    <div key={line}>• {line}</div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Operator flow</div>
                <div className="mt-3 space-y-2 text-sm leading-6 text-foreground">
                  {operatorFlow.map((line) => (
                    <div key={line}>• {line}</div>
                  ))}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <CardTitle>Current onchain proof status</CardTitle>
              </div>
              <CardDescription>{architectProof.currentOnchainProofStatus.label}</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm leading-6 text-foreground">
                {architectProof.currentOnchainProofStatus.summary}
              </div>
              <div className="grid gap-3">
                {architectProof.currentOnchainProofStatus.details.map((line) => (
                  <div key={line} className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm leading-6 text-foreground">
                    {line}
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <div className="flex items-center gap-2">
                <FileText className="h-5 w-5 text-primary" />
                <CardTitle>Safety boundaries</CardTitle>
              </div>
              <CardDescription>These are the guardrails the public demo keeps visible.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {architectProof.safetyBoundaries.map((line) => (
                <div key={line} className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm leading-6 text-foreground">
                  {line}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <CardTitle>Deployment evidence</CardTitle>
              <CardDescription>The reviewer can validate the live deployment without leaving this page.</CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Production URL</div>
                <div className="mt-2 break-all text-sm text-foreground">{architectProof.productionUrl}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Latest deployment URL</div>
                <div className="mt-2 break-all text-sm text-foreground">{architectProof.latestDeploymentUrl}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Deployment hash</div>
                <div className="mt-2 break-all text-sm text-foreground">{architectProof.deploymentHash}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Main commit</div>
                <div className="mt-2 break-all text-sm text-foreground">{architectProof.mainCommit}</div>
                <div className="mt-1 text-xs text-muted-foreground">Branch {architectProof.mainBranch}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Arc Testnet chain ID</div>
                <div className="mt-2 text-sm text-foreground">{architectProof.arcTestnetChainId}</div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Agent proof</div>
                <div className="mt-2 text-sm text-foreground">
                  #{arcAgentId.toString()} / {arcAgentValidationTag}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">Arc Testnet-linked identity</div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <CardTitle>Arcscan links</CardTitle>
              <CardDescription>Address pages for the contracts and agent registries used by the demo.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {architectProof.arcscanLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
                >
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{link.label}</div>
                  <div className="mt-2 break-all text-sm text-foreground">{link.value}</div>
                </a>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <CardTitle>Screenshot checklist</CardTitle>
              <CardDescription>Use these when capturing the public demo for Arc review or social sharing.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {architectProof.screenshotChecklist.map((line) => (
                <div key={line} className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm leading-6 text-foreground">
                  {line}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <CardTitle>Suggested Arc House post</CardTitle>
              <CardDescription>Ready to paste, with the proof framing kept short and plain.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Title</div>
                <div className="mt-2 text-sm font-medium text-foreground">
                  Arc USDC Rebalancer: report-first treasury operations on Arc Testnet
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Body</div>
                <pre className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
{`I built a public treasury-ops demo on Arc Testnet.

Arc USDC Rebalancer is a readiness checker + operator brief + optional live execution surface. Visitors can open the dashboard without a wallet, generate a readiness report, compare treasury scenarios, and copy a markdown report or action pack. Live execution only appears when the operator wallet, live policy, Circle readiness, executor, and actionable report are all ready.

What it uses:
- Arc Testnet
- USDC treasury policy
- TreasuryPolicy contract
- TreasuryExecutor contract
- Arc agent identity and operator brief
- Circle developer-controlled wallet and Gateway readiness
- Operator-gated live execution

What it demonstrates:
- report-first treasury operations
- clear preview vs live execution boundaries
- no silent transactions
- no execution without live dependencies
- stablecoin treasury actions that can be inspected before execution

Demo: ${architectProof.productionUrl}/dashboard
Repo: ${architectProof.githubRepoUrl}
`}
                </pre>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <a href={architectProof.arcHousePostUrl} target="_blank" rel="noreferrer">
                    Open Arc House post link
                    <ArrowRight className="h-4 w-4" />
                  </a>
                </Button>
                <Button asChild variant="outline">
                  <Link href="/dashboard">Open dashboard</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-white/10 bg-card/85">
          <CardHeader>
            <CardTitle>Short social post</CardTitle>
            <CardDescription>Short enough to paste into X without extra editing.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm leading-6 text-foreground">
              {`@Arc @samconnerone Shipped a public Arc Testnet treasury demo: report-first readiness reports, operator brief, Circle wallets/Gateway, and optional live execution. Demo: ${architectProof.productionUrl}/dashboard`}
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
