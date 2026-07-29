import type { Metadata } from 'next'
import Link from 'next/link'
import {
  ExternalLink,
  FileText,
  Github,
  PlayCircle,
  ShieldCheck,
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

export const metadata: Metadata = {
  title: 'Arc USDC Rebalancer · three-minute demo',
  description:
    'Watch the three-minute DeFi Track demo and open the public Arc USDC Rebalancer submission artifacts.',
}

const demoPath = [
  {
    time: '0:00-0:40',
    title: 'Live Arc and Circle inputs',
    detail:
      'The Treasury Brief reads the deployed policy, executor balance, validation signal, and Circle readiness.',
  },
  {
    time: '0:40-1:10',
    title: 'Bounded top-up and hold',
    detail:
      'Below-minimum and in-band scenarios show how one policy produces reviewable outcomes.',
  },
  {
    time: '1:10-1:40',
    title: 'Bounded trim and action pack',
    detail:
      'The demo exposes exact USDC units, reason codes, Arc addresses, and a receipt marked not published.',
  },
  {
    time: '1:40-2:10',
    title: 'Execution remains locked',
    detail:
      'The public UI has no signer, the legacy executor is not wired, and a valid write request fails closed.',
  },
  {
    time: '2:10-2:40',
    title: 'Reproducible safety evidence',
    detail:
      'The case study covers 1,003 deterministic balance cases, 9/9 safety gates, and zero submitted transactions.',
  },
  {
    time: '2:40-3:00',
    title: 'DeFi Track conclusion',
    detail:
      'The MVP prepares auditable treasury actions on Arc without claiming custody, settlement, or a completed transfer.',
  },
]

const narrationTranscript = [
  {
    time: '0:00-0:10',
    text: `Arc USDC Rebalancer is our DeFi Track MVP: policy-bound USDC treasury decisions on Arc Testnet, with Circle Wallets Gateway readiness.`,
  },
  {
    time: '0:10-0:40',
    text: `On the production dashboard, Treasury Brief reads the deployed Arc policy, the executor's USDC balance, its validation signal, and Circle control-plane readiness. Those independent reads become one source-labelled result. The site is functional, but deliberately report-first: it never asks for a wallet, and it cannot send a treasury transaction.`,
  },
  {
    time: '0:40-0:55',
    text: `Here, the scenario balance is seventy-five USDC, below the one-hundred-USDC minimum. The deterministic policy recommends a top-up, capped by both the target gap and the maximum rebalance amount. It creates a review action, not a transfer.`,
  },
  {
    time: '0:55-1:10',
    text: `At five hundred USDC, the balance sits inside the allowed band, so the result changes to hold. No amount is requested, and the action pack records a zero-value payload for review.`,
  },
  {
    time: '1:10-1:40',
    text: `At seven hundred USDC, the same policy recommends a bounded trim toward the target. The operator can inspect the reason codes, exact USDC units, chain ID, token address, and executor address, then copy Markdown or JSON. These exports are decision artifacts only. They are marked not published and contain no transaction hash.`,
  },
  {
    time: '1:40-2:10',
    text: `The public execution gate remains locked. The legacy executor is not wired, there is no signing interface, and the API rejects execution even if the environment flag changes. The Arc evidence page exposes chain ID five zero four two zero zero two, the deployed policy and executor addresses, and the native USDC asset, without claiming custody or settlement.`,
  },
  {
    time: '2:10-2:40',
    text: `The architecture keeps live reads, deterministic evaluation, and reporting separate from any transaction path. The reproducible case study covers below-band, in-band, and above-band scenarios; expected decisions in every case; nine out of nine safety gates; and zero submitted transactions.`,
  },
  {
    time: '2:40-3:00',
    text: `This is a complete MVP: real Arc and Circle evidence, bounded DeFi treasury recommendations, and auditable outputs that reviewers can reproduce from the public repository. It prepares a reviewable action; it does not claim a completed transfer. The dashboard, code, deck, and case study are public.`,
  },
]

const reviewerChecks = [
  'Functional read, evaluate, and report workflow backed by live Arc Testnet state.',
  'Meaningful USDC treasury use case with Circle Wallets and Gateway readiness.',
  'DeFi Track only; no Agentic Economy or autonomous custody claim.',
  'Public execution status remains disabled and no treasury transaction is claimed.',
]

export default function DemoPage() {
  return (
    <main className="min-h-screen pb-16">
      <SiteHeader
        eyebrow="Final demo"
        title="Arc USDC Rebalancer"
        description="Three-minute DeFi Track pitch and product walkthrough."
        ctaHref="/dashboard"
        ctaLabel="Open dashboard"
      />

      <section className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-4 pb-8 pt-2 sm:px-6 lg:px-8">
        <Card className="overflow-hidden border-primary/20 bg-card/90">
          <CardHeader className="space-y-4">
            <div className="flex flex-wrap gap-2">
              <Badge variant="success">3:00 verified duration</Badge>
              <Badge
                variant="outline"
                className="border-primary/25 bg-primary/10 text-primary"
              >
                DeFi Track
              </Badge>
              <Badge
                variant="outline"
                className="border-white/15 bg-white/5 text-foreground"
              >
                Arc Testnet
              </Badge>
              <Badge
                variant="outline"
                className="border-white/15 bg-white/5 text-foreground"
              >
                Public execution locked
              </Badge>
            </div>
            <div>
              <CardTitle className="text-3xl">
                Policy-bound USDC treasury decisions before execution
              </CardTitle>
              <CardDescription className="mt-2 max-w-4xl text-base leading-7">
                The demo covers what was built, how the policy workflow works,
                why it fits the DeFi Track, and how Arc, USDC, Circle
                developer-controlled Wallets, and Gateway are used.
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="overflow-hidden rounded-2xl border border-white/10 bg-black shadow-2xl">
              <video
                className="aspect-video w-full"
                controls
                playsInline
                preload="metadata"
              >
                <source src={projectProof.demoVideoUrl} type="video/mp4" />
                Your browser cannot play this video. Use the direct MP4 link
                below.
              </video>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild>
                <a href={projectProof.demoVideoUrl}>
                  <PlayCircle className="h-4 w-4" />
                  Open direct MP4
                </a>
              </Button>
              <Button asChild variant="outline">
                <a
                  href={projectProof.deckPdfUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <FileText className="h-4 w-4" />
                  View deck PDF
                </a>
              </Button>
              <Button asChild variant="outline">
                <a
                  href={projectProof.githubRepoUrl}
                  target="_blank"
                  rel="noreferrer"
                >
                  <Github className="h-4 w-4" />
                  Open repository
                </a>
              </Button>
              <Button asChild variant="outline">
                <Link href="/case-study">
                  Reproduce evidence
                  <ExternalLink className="h-4 w-4" />
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <CardTitle>Three-minute review path</CardTitle>
              <CardDescription>
                Each segment maps directly to the official final-demo
                requirements.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-3">
              {demoPath.map((segment) => (
                <div
                  key={segment.time}
                  className="grid gap-2 rounded-2xl border border-white/10 bg-background/50 p-4 sm:grid-cols-[6rem_1fr]"
                >
                  <div className="font-mono text-sm text-primary">
                    {segment.time}
                  </div>
                  <div>
                    <div className="font-medium text-foreground">
                      {segment.title}
                    </div>
                    <p className="mt-1 text-sm leading-6 text-muted-foreground">
                      {segment.detail}
                    </p>
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <div className="flex items-center gap-2">
                <ShieldCheck className="h-5 w-5 text-primary" />
                <CardTitle>Reviewer checks</CardTitle>
              </div>
              <CardDescription>
                The video, deck, repository, and live product use the same
                evidence boundary.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {reviewerChecks.map((check) => (
                <div
                  key={check}
                  className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm leading-6 text-foreground"
                >
                  {check}
                </div>
              ))}
              <div className="rounded-2xl border border-accent/30 bg-accent/10 p-4 text-sm leading-6 text-foreground">
                No wallet connection, private key, signed execution path,
                transaction hash, or completed treasury transfer is presented
                as part of this public submission.
              </div>
            </CardContent>
          </Card>
        </div>

        <Card className="border-white/10 bg-card/85">
          <CardHeader>
            <CardTitle>Full narration transcript</CardTitle>
            <CardDescription>
              The readable transcript matches the final 180-second narration
              source.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <details className="rounded-2xl border border-white/10 bg-background/50 p-4">
              <summary className="cursor-pointer font-medium text-foreground">
                Read the complete transcript
              </summary>
              <div className="mt-5 grid gap-4">
                {narrationTranscript.map((segment) => (
                  <div
                    key={segment.time}
                    className="grid gap-2 border-t border-white/10 pt-4 first:border-t-0 first:pt-0 sm:grid-cols-[6rem_1fr]"
                  >
                    <div className="font-mono text-sm text-primary">
                      {segment.time}
                    </div>
                    <p className="text-sm leading-7 text-muted-foreground">
                      {segment.text}
                    </p>
                  </div>
                ))}
              </div>
            </details>
          </CardContent>
        </Card>
      </section>
    </main>
  )
}
