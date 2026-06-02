import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ArrowRight,
  BadgeCheck,
  BookOpenText,
  CheckCircle2,
  FileText,
  ShieldAlert,
  Sparkles,
} from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SiteHeader } from '@/components/site-header'
import {
  operatorBriefActions,
  operatorBriefChecklist,
  operatorBriefEvidence,
  operatorBriefSummary,
} from '@/lib/operator-brief'
import { projectTrailSummary } from '@/lib/project-trail'

export const metadata: Metadata = {
  title: 'Arc USDC Rebalancer · operator brief',
  description:
    'A public operator brief for the installed robot inside the Arc USDC Rebalancer project.',
}

const reviewerSteps = [
  'Open this packet and read the status note first.',
  'Verify the dashboard report, the case study, and the release notes.',
  'Check the repo trail and the live deployment for the same story.',
  'Confirm the robot brief matches the live operator flow instead of just describing it.',
]

const docsContext = [
  'The installed robot is used as an operator assistant inside this project.',
  'The dashboard is the real review surface where the robot turns state into a report.',
  'The live action path is gated so the robot can recommend before it can execute.',
  'The repo, live deployment, and notes should all tell the same story.',
]

export default function OperatorPage() {
  return (
    <main className="min-h-screen pb-16">
      <SiteHeader
        eyebrow="Operator brief"
        title="Arc USDC Rebalancer"
        description="A plain brief for the installed robot: what it does here, how to verify it, and what is intentionally public."
        ctaHref="/dashboard"
        ctaLabel="Open checker"
      />

      <section className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-4 pb-8 pt-2 sm:px-6 lg:px-8">
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-white/15 bg-white/5 text-foreground">
                {projectTrailSummary.buildLabel}
              </Badge>
              <Badge variant="success">Operator brief</Badge>
              <Badge variant="outline" className="border-white/15 bg-white/5 text-foreground">
                Not a badge claim
              </Badge>
            </div>
            <CardTitle className="text-3xl">{operatorBriefSummary.headline}</CardTitle>
            <CardDescription className="max-w-3xl text-base leading-7">
              {operatorBriefSummary.reviewGoal} {operatorBriefSummary.statusNote}
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 lg:grid-cols-[1.15fr_0.85fr]">
            <div className="rounded-3xl border border-white/10 bg-background/50 p-5">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                <FileText className="h-4 w-4 text-primary" />
                Suggested operator note
              </div>
              <p className="mt-3 text-sm leading-7 text-foreground">
                This repository packages a public Arc Testnet treasury demo with a live agent brief, report-first
                execution flow, developer-controlled wallets readiness, and visible maintenance notes. The brief is
                meant to help a human understand how the installed robot is being used in this project.
              </p>
            </div>
            <div className="rounded-3xl border border-white/10 bg-background/50 p-5">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.2em] text-muted-foreground">
                <ShieldAlert className="h-4 w-4 text-primary" />
                Boundary
              </div>
              <p className="mt-3 text-sm leading-7 text-foreground">
                The site explains the robot workflow. It does not claim a badge, a role, or any exception from Arc
                rules.
              </p>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1.08fr_0.92fr]">
          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <div className="flex items-center gap-2">
                <Sparkles className="h-5 w-5 text-primary" />
                <CardTitle>What this brief proves</CardTitle>
              </div>
              <CardDescription>
                A reviewer should be able to read this page and know exactly what to inspect next.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {operatorBriefEvidence.map((item) => (
                <div key={item.label} className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{item.label}</div>
                  <div className="mt-2 text-sm leading-6 text-foreground">{item.value}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <div className="flex items-center gap-2">
                <BookOpenText className="h-5 w-5 text-primary" />
                <CardTitle>How the project frames the robot</CardTitle>
              </div>
              <CardDescription>
                These are the public facts the project keeps visible alongside the installed robot.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {docsContext.map((line) => (
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
                <CheckCircle2 className="h-5 w-5 text-primary" />
                <CardTitle>Checklist</CardTitle>
              </div>
              <CardDescription>Use this checklist to judge the build on its own terms.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {operatorBriefChecklist.map((item) => (
                <div key={item} className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm leading-6 text-foreground">
                  {item}
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <div className="flex items-center gap-2">
                <BadgeCheck className="h-5 w-5 text-primary" />
                <CardTitle>What to inspect in order</CardTitle>
              </div>
              <CardDescription>Keep the path short so the evidence reads like a real project brief.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {reviewerSteps.map((step, index) => (
                <div key={step} className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-sm font-semibold text-primary">
                      0{index + 1}
                    </div>
                    <div className="text-sm leading-6 text-foreground">{step}</div>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="border-white/10 bg-card/85">
          <CardHeader>
            <CardTitle>Evidence trail</CardTitle>
            <CardDescription>The same story should be visible in the repo, the live site, and the notes.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-2">
            {operatorBriefActions.map((action) => {
              const isExternal = action.href.startsWith('http')
              const linkContent = (
                <>
                  <div className="text-xs uppercase tracking-[0.18em] text-muted-foreground">{action.label}</div>
                  <div className="mt-2 text-sm text-foreground">{action.detail}</div>
                </>
              )

              return isExternal ? (
                <a
                  key={action.label}
                  href={action.href}
                  target="_blank"
                  rel="noreferrer"
                  className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
                >
                  {linkContent}
                </a>
              ) : (
                <Link
                  key={action.label}
                  href={action.href}
                  className="rounded-2xl border border-white/10 bg-background/50 p-4 transition-colors hover:border-primary/30 hover:bg-background/70"
                >
                  {linkContent}
                </Link>
              )
            })}
          </CardContent>
        </Card>

        <Card className="border-white/10 bg-card/85">
          <CardHeader>
            <CardTitle>Open the review surface</CardTitle>
            <CardDescription>Move from the brief to the live demo without hunting through the site.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap gap-3">
            <Button asChild>
              <Link href="/dashboard">
                Open checker
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            {operatorBriefActions.map((action) => {
              const isExternal = action.href.startsWith('http')
              return (
                <Button key={action.label} asChild variant="outline">
                  {isExternal ? (
                    <a href={action.href} target="_blank" rel="noreferrer">
                      {action.label}
                    </a>
                  ) : (
                    <Link href={action.href}>{action.label}</Link>
                  )}
                </Button>
              )
            })}
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
