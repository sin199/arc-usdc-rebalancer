import Link from 'next/link'
import { ArrowRight, CalendarDays, CheckCircle2, NotebookPen, TriangleAlert } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { SiteHeader } from '@/components/site-header'
import {
  projectKnownGaps,
  projectReferenceLinks,
  projectReleaseNotes,
  projectTrailSummary,
} from '@/lib/project-trail'

export default function NotesPage() {
  return (
    <main className="min-h-screen pb-16">
      <SiteHeader
        eyebrow="Release notes"
        title="Arc USDC Rebalancer"
        description="A small written trail of what changed, what remains rough, and where to review the current build."
        ctaHref="/dashboard"
        ctaLabel="Open dashboard"
      />

      <section className="mx-auto flex w-full max-w-screen-2xl flex-col gap-6 px-4 pb-8 pt-2 sm:px-6 lg:px-8">
        <Card className="border-primary/20 bg-primary/5">
          <CardHeader className="space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Badge variant="outline" className="border-white/15 bg-white/5 text-foreground">
                {projectTrailSummary.buildLabel}
              </Badge>
              <Badge variant="success">Public demo first</Badge>
            </div>
            <CardTitle className="text-2xl">What this build is trying to be</CardTitle>
            <CardDescription className="max-w-3xl">
              {projectTrailSummary.headline} The point of this page is to make the current state of the project easy
              to read without opening the dashboard first.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-3">
            <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <CalendarDays className="h-4 w-4 text-primary" />
                Last reviewed
              </div>
              <div className="mt-2 text-sm text-foreground">{projectTrailSummary.lastReviewed}</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <CheckCircle2 className="h-4 w-4 text-primary" />
                Current focus
              </div>
              <div className="mt-2 text-sm text-foreground">Public demo path, visible notes, and honest live gating.</div>
            </div>
            <div className="rounded-2xl border border-white/10 bg-background/50 p-4">
              <div className="flex items-center gap-2 text-xs uppercase tracking-[0.18em] text-muted-foreground">
                <NotebookPen className="h-4 w-4 text-primary" />
                Where to look
              </div>
              <div className="mt-2 text-sm text-foreground">Homepage, dashboard, maintenance log, and GitHub repo.</div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-[1.1fr_0.9fr]">
          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <CardTitle>Recent changes</CardTitle>
              <CardDescription>
                The last few changes that made the project read more like a maintained build instead of a static demo.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {projectReleaseNotes.map((note) => (
                <div key={note.title} className="rounded-2xl border border-white/10 bg-background/50 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="font-medium text-foreground">{note.title}</div>
                    <Badge variant="outline">{note.tag}</Badge>
                  </div>
                  <div className="mt-2 text-sm leading-6 text-muted-foreground">{note.detail}</div>
                  <div className="mt-3 text-xs uppercase tracking-[0.18em] text-muted-foreground">{note.date}</div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="border-white/10 bg-card/85">
            <CardHeader>
              <div className="flex items-center gap-2">
                <TriangleAlert className="h-5 w-5 text-primary" />
                <CardTitle>Known gaps</CardTitle>
              </div>
              <CardDescription>These are the edges that are intentionally left visible.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              {projectKnownGaps.map((gap) => (
                <div key={gap} className="rounded-2xl border border-white/10 bg-background/50 p-4 text-sm leading-6 text-muted-foreground">
                  {gap}
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        <Card className="border-white/10 bg-card/85">
          <CardHeader>
            <CardTitle>Open the working surface</CardTitle>
            <CardDescription>Keep the route simple for anyone who wants to verify the project quickly.</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-4">
            <Button asChild>
              <Link href="/dashboard">
                Open dashboard
                <ArrowRight className="h-4 w-4" />
              </Link>
            </Button>
            {projectReferenceLinks
              .filter((link) => link.href !== '/notes')
              .map((link) => (
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
