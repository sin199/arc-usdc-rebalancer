import type { Metadata } from 'next'
import Link from 'next/link'
import {
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
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { SiteHeader } from '@/components/site-header'
import { projectProof } from '@/lib/project-proof'
import { arcAgentId, arcAgentValidationTag } from '@/lib/arc-agent'

export const metadata: Metadata = {
  title: 'Arc USDC Rebalancer · system architecture',
  description:
    'System architecture, deployment evidence, onchain status, and safety boundaries for Arc USDC Rebalancer.',
}

const systemIncludes = [
  'A public Arc Testnet treasury demo with a report-first readiness checker.',
  'A compact treasury operations brief that explains the policy workflow used in the project.',
  'A live-execution boundary that is hard-disabled in the public deployment.',
  'A fail-closed control plane with signed operator actions and durable replay protection.',
]

const whyItMatters = [
  'It turns the treasury flow into something a reviewer can inspect in one pass.',
  'It separates preview mode from live execution instead of mixing the two together.',
  'It keeps the Arc Testnet policy, identity evidence, executor, and report trail visible in the same build.',
  'It turns architecture decisions into inspectable code, deployment evidence, and testable safety controls.',
]

const visitorFlow = [
  'Open the homepage and read the 30-second visitor path.',
  'Open the dashboard without a wallet and generate a readiness report.',
  'Copy the markdown report or action pack from preview mode.',
  'Compare the At target, Below minimum, and Above target scenarios.',
]

const operatorFlow = [
  'Open the public dashboard without a wallet.',
  'Load the live policy snapshot and inspect the execution boundary.',
  'Keep Circle wallet-set readiness visible as a dependency signal.',
  'The submitted public deployment keeps all treasury writes disabled.',
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
    href: projectProof.productionUrl,
    value: projectProof.productionUrl,
  },
  {
    label: 'Dashboard',
    href: `${projectProof.productionUrl}/dashboard`,
    value: `${projectProof.productionUrl}/dashboard`,
  },
  {
    label: 'System architecture',
    href: `${projectProof.productionUrl}/architecture`,
    value: `${projectProof.productionUrl}/architecture`,
  },
  {
    label: 'Treasury operations brief',
    href: `${projectProof.productionUrl}/operator`,
    value: `${projectProof.productionUrl}/operator`,
  },
  {
    label: 'Case study',
    href: `${projectProof.productionUrl}/case-study`,
    value: `${projectProof.productionUrl}/case-study`,
  },
  {
    label: 'Release notes',
    href: `${projectProof.productionUrl}/notes`,
    value: `${projectProof.productionUrl}/notes`,
  },
  {
    label: 'GitHub repo',
    href: projectProof.githubRepoUrl,
    value: 'sin199/arc-usdc-rebalancer',
  },
]

export default function ArchitecturePage() {
  return (
    <main className="min-h-screen pb-16">
      <SiteHeader
        eyebrow="System architecture"
        title="Arc USDC Rebalancer"
        description="How the treasury decision engine, agent, policy, execution rail, authorization guard, and deployment evidence fit together."
        ctaHref="/dashboard"
        ctaLabel="Open dashboard"
      />

      <section className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-4 pb-8 pt-2 sm:px-6 lg:px-8">
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="border-white/15 bg-white/5 text-foreground"
              >
                Verified Arc Testnet demo
              </Badge>
              <Badge variant="success">Report first</Badge>
              <Badge
                variant="outline"
                className="border-white/15 bg-white/5 text-foreground"
              >
                Execution disabled in public deployment
              </Badge>
              <Badge
                variant="outline"
                className="border-white/15 bg-white/5 text-foreground"
              >
                Auditable controls
              </Badge>
            </div>
            <CardTitle className="text-3xl">
              Built as a verifiable treasury control system
            </CardTitle>
            <CardDescription className="max-w-3xl text-base leading-7">
              The site proves a report-first treasury decision flow on Arc
              Testnet. The public deployment reads live policy, balance,
              validation, and Circle readiness, but does not submit treasury
              transactions. Its write boundary remains visibly fail-closed.
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
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  {item.label}
                </div>
                <div className="mt-2 break-all text-sm leading-6 text-foreground">
                  {item.value}
                </div>
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
                <CardTitle>What the system includes</CardTitle>
              </div>
              <CardDescription>
                The product surface stays short; this page explains the system
                behind it.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {systemIncludes.map((line) => (
                <div
                  key={line}
                  className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm leading-6 text-foreground"
                >
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
              <CardDescription>
                The architecture should be understandable from product action to
                onchain effect.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {whyItMatters.map((line) => (
                <div
                  key={line}
                  className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm leading-6 text-foreground"
                >
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
              <CardDescription>
                These are the same live surfaces exposed by the product.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-wrap gap-2">
              {surfaceItems.map((item) => (
                <Badge
                  key={item}
                  variant="outline"
                  className="border-white/15 bg-white/5 text-foreground"
                >
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
              <CardDescription>
                Preview mode stays useful without a wallet. Live mode is
                explicit.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Public visitor flow
                </div>
                <div className="mt-3 space-y-2 text-sm leading-6 text-foreground">
                  {visitorFlow.map((line) => (
                    <div key={line}>• {line}</div>
                  ))}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Operator flow
                </div>
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
              <CardDescription>
                {projectProof.currentOnchainProofStatus.label}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm leading-6 text-foreground">
                {projectProof.currentOnchainProofStatus.summary}
              </div>
              <div className="grid gap-3">
                {projectProof.currentOnchainProofStatus.details.map((line) => (
                  <div
                    key={line}
                    className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm leading-6 text-foreground"
                  >
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
              <CardDescription>
                These are the guardrails the public demo keeps visible.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {projectProof.safetyBoundaries.map((line) => (
                <div
                  key={line}
                  className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm leading-6 text-foreground"
                >
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
              <CardDescription>
                The reviewer can validate the live deployment and its evidence
                boundary without leaving this page.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Production URL
                </div>
                <div className="mt-2 break-all text-sm text-foreground">
                  {projectProof.productionUrl}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Latest deployment URL
                </div>
                <div className="mt-2 break-all text-sm text-foreground">
                  {projectProof.latestDeploymentUrl}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Deployment hash
                </div>
                <div className="mt-2 break-all text-sm text-foreground">
                  {projectProof.deploymentHash}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Deployment commit
                </div>
                <div className="mt-2 break-all text-sm text-foreground">
                  {projectProof.mainCommit}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Branch {projectProof.mainBranch}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Arc Testnet chain ID
                </div>
                <div className="mt-2 text-sm text-foreground">
                  {projectProof.arcTestnetChainId}
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Agent proof
                </div>
                <div className="mt-2 text-sm text-foreground">
                  #{arcAgentId.toString()} / {arcAgentValidationTag}
                </div>
                <div className="mt-1 text-xs text-muted-foreground">
                  Arc Testnet-linked identity
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <CardTitle>Arcscan links</CardTitle>
              <CardDescription>
                Address pages for the contracts and agent registries used by the
                demo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {projectProof.arcscanLinks.map((link) => (
                <a
                  key={link.label}
                  href={link.href}
                  target="_blank"
                  rel="noreferrer"
                  className="block rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
                >
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                    {link.label}
                  </div>
                  <div className="mt-2 break-all text-sm text-foreground">
                    {link.value}
                  </div>
                </a>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1fr_1fr]">
          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <CardTitle>Screenshot checklist</CardTitle>
              <CardDescription>
                Use these when capturing the public demo for Arc review or
                social sharing.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {projectProof.screenshotChecklist.map((line) => (
                <div
                  key={line}
                  className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm leading-6 text-foreground"
                >
                  {line}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <CardTitle>Suggested Arc House post</CardTitle>
              <CardDescription>
                Ready to paste, with the proof framing kept short and plain.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Title
                </div>
                <div className="mt-2 text-sm font-medium text-foreground">
                  Arc USDC Rebalancer: report-first treasury operations on Arc
                  Testnet
                </div>
              </div>
              <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">
                  Body
                </div>
                <pre className="mt-2 whitespace-pre-wrap text-sm leading-6 text-foreground">
                  {`Arc USDC Rebalancer is a public DeFi Treasury decision MVP on Arc Testnet: a readiness checker + treasury operations brief + auditable action pack. Visitors can open the dashboard without a wallet, generate a readiness report, compare treasury scenarios, and copy a markdown report or action pack. The public deployment is non-executing and reports its write boundary explicitly.

What it uses:
- Arc Testnet
- USDC treasury policy
- TreasuryPolicy contract
- TreasuryExecutor contract
- Arc-linked onchain identity evidence and treasury operations brief
- Circle developer-controlled wallet and Gateway readiness as live dependency signals
- No public treasury write; exported receipts remain not published

What it demonstrates:
- report-first treasury operations
- clear preview vs live execution boundaries
- no silent transactions
- no execution without live dependencies
- stablecoin treasury actions that can be inspected before execution

Demo: ${projectProof.productionUrl}/dashboard
Repo: ${projectProof.githubRepoUrl}
`}
                </pre>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href="/dashboard">Open dashboard</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-white/10 bg-card/85">
          <CardHeader>
            <CardTitle>Short social post</CardTitle>
            <CardDescription>
              Short enough to paste into X without extra editing.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm leading-6 text-foreground">
              {`@Arc @samconnerone Shipped a public Arc Testnet DeFi Track treasury decision MVP: report-first readiness reports, a treasury operations brief, USDC policy decisions, and Circle Wallets/Gateway readiness signals. The public deployment sends no treasury transaction. Demo: ${projectProof.productionUrl}/dashboard`}
            </div>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
