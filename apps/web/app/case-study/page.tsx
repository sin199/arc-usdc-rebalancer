import Link from 'next/link'
import { ArrowRight, CheckCircle2, FileText, PlayCircle, Route } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SiteHeader } from '@/components/site-header'
import { arcTestnetExplorerUrl, arcTestnetRpcUrl } from '@arc-usdc-rebalancer/shared'
import { arcAgentId, arcAgentValidationTag } from '@/lib/arc-agent'
import { projectReferenceLinks, projectTrailSummary } from '@/lib/project-trail'

const replaySteps = [
  {
    title: 'Open the case study',
    detail: 'Start here if you want the 3-minute explanation before looking at the live checker.',
  },
  {
    title: 'Open the dashboard',
    detail: 'Generate a readiness report from the current balance and policy inputs.',
  },
  {
    title: 'Compare the scenarios',
    detail: 'Use the sample states to see how the same report changes when the balance moves.',
  },
  {
    title: 'Inspect the evidence',
    detail: 'Check the report markdown, the notes page, and the repo trail before judging the build.',
  },
]

const proofPoints = [
  'Public visitors can understand the build without a wallet.',
  'The dashboard produces one readable report instead of a wall of disconnected status cards.',
  'The Arc Testnet policy, Circle readiness, and executor state are visible in the same place.',
  'The live operator path stays gated until the onchain pieces are actually configured.',
]

const localRunSteps = [
  'pnpm install',
  'pnpm --filter @arc-usdc-rebalancer/web dev',
  'Open http://localhost:3000/case-study',
  'Open http://localhost:3000/dashboard',
]

export default function CaseStudyPage() {
  return (
    <main className="min-h-screen pb-16">
      <SiteHeader
        eyebrow="Case study"
        title="Arc USDC Rebalancer"
        description="A short public path for reviewers: what this repo proves, how to replay it, and what to inspect first."
        ctaHref="/architects"
        ctaLabel="Open packet"
      />

      <section className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-4 pb-8 pt-2 sm:px-6 lg:px-8">
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-white/15 bg-white/5 text-foreground">
                {projectTrailSummary.buildLabel}
              </Badge>
              <Badge variant="success">3-minute review</Badge>
              <Badge variant="outline" className="border-white/15 bg-white/5 text-foreground">
                1-minute local run
              </Badge>
            </div>
            <CardTitle className="text-3xl">What this project proves</CardTitle>
            <CardDescription className="max-w-3xl">
              {projectTrailSummary.headline} The point of this page is to make the working build easy to replay without
              opening every surface first.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Reviewer signal
              </div>
              <div className="mt-2 text-sm leading-6 text-foreground">
                Arc reviewers can open one public page and see the report path, the live policy path, and the operator
                gate without guessing where to click next.
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <FileText className="h-4 w-4 text-primary" />
                Output
              </div>
              <div className="mt-2 text-sm leading-6 text-foreground">
                The dashboard emits a copyable treasury readiness report that can be pasted into chat, docs, or GitHub.
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <Route className="h-4 w-4 text-primary" />
                Surface
              </div>
              <div className="mt-2 text-sm leading-6 text-foreground">
                Arc Testnet policy, Circle readiness, executor state, and agent identity are visible in one flow.
              </div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <PlayCircle className="h-4 w-4 text-primary" />
                Replay
              </div>
              <div className="mt-2 text-sm leading-6 text-foreground">
                You can replay the same flow locally in preview mode before you ever connect a live operator wallet.
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <CardTitle>How to replay it</CardTitle>
              <CardDescription>Four steps, one short path, no extra context needed.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {replaySteps.map((step, index) => (
                <div key={step.title} className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-sm font-semibold text-primary">
                      0{index + 1}
                    </div>
                    <div>
                      <div className="font-medium text-foreground">{step.title}</div>
                      <div className="mt-1 text-sm leading-6 text-muted-foreground">{step.detail}</div>
                    </div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <CardTitle>What to inspect first</CardTitle>
              <CardDescription>
                The fastest way to tell whether the project is useful is to check these four things.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {proofPoints.map((point) => (
                <div key={point} className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm leading-6 text-foreground">
                  {point}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <div className="grid gap-6 lg:grid-cols-[0.92fr_1.08fr]">
          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <CardTitle>1-minute local run</CardTitle>
              <CardDescription>Use preview mode locally first. Live mode is optional and gated.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="rounded-2xl border border-white/10 bg-background/60 p-4 font-mono text-sm leading-7 text-foreground">
                {localRunSteps.map((step) => (
                  <div key={step}>{step}</div>
                ))}
              </div>
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <CardTitle>Review checklist</CardTitle>
              <CardDescription>
                These are the exact items to verify before you call the build useful or not.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3 md:grid-cols-2">
              <a
                href="/dashboard"
                className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
              >
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Dashboard</div>
                <div className="mt-2 text-sm text-foreground">Generate the report and inspect the evidence grid.</div>
              </a>
              <a
                href="/notes"
                className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
              >
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Notes</div>
                <div className="mt-2 text-sm text-foreground">Read the maintenance trail and known gaps.</div>
              </a>
              <a
                href={arcTestnetExplorerUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
              >
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Explorer</div>
                <div className="mt-2 text-sm text-foreground">{arcTestnetExplorerUrl}</div>
              </a>
              <a
                href={arcTestnetRpcUrl}
                target="_blank"
                rel="noreferrer"
                className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
              >
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">RPC</div>
                <div className="mt-2 text-sm text-foreground">{arcTestnetRpcUrl}</div>
              </a>
              <a
                href="https://github.com/sin199/arc-usdc-rebalancer"
                target="_blank"
                rel="noreferrer"
                className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
              >
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">GitHub</div>
                <div className="mt-2 text-sm text-foreground">sin199/arc-usdc-rebalancer</div>
              </a>
              <div className="rounded-2xl border border-white/10 bg-primary/10 p-4">
                <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">Agent</div>
                <div className="mt-2 text-sm text-foreground">
                  #{arcAgentId.toString()} · {arcAgentValidationTag}
                </div>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-white/10 bg-card/85">
          <CardHeader>
            <CardTitle>Open the working surface</CardTitle>
            <CardDescription>Use the links below when you want to move from reading to checking the live build.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/architects">
                Open architects packet
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            <Button asChild>
              <Link href="/dashboard">
                Open checker
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            {projectReferenceLinks.filter((link) => link.href !== '/case-study').map((link) => (
              <Button key={link.label} asChild variant="outline">
                <a
                  href={link.href}
                  target={link.href.startsWith('http') ? '_blank' : undefined}
                  rel={link.href.startsWith('http') ? 'noreferrer' : undefined}
                >
                  {link.label}
                </a>
              </Button>
            ))}
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
