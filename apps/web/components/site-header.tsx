import Link from 'next/link'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'

type SiteHeaderProps = {
  eyebrow: string
  title: string
  description: string
  ctaHref: string
  ctaLabel: string
}

export function SiteHeader({ eyebrow, title, description, ctaHref, ctaLabel }: SiteHeaderProps) {
  return (
    <header className="mx-auto flex w-full max-w-6xl flex-col gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl border border-primary/20 bg-primary/10 text-sm font-semibold text-primary shadow-[0_0_40px_-16px_rgba(16,185,129,0.55)]">
            AU
          </div>
          <div>
            <Badge variant="outline" className="mb-2 border-primary/25 bg-primary/10 text-primary">
              {eyebrow}
            </Badge>
            <h1 className="font-display text-xl font-semibold tracking-tight">{title}</h1>
            <p className="text-sm text-muted-foreground">{description}</p>
          </div>
        </div>
        <Button asChild variant="outline" className="hidden sm:inline-flex">
          <Link href={ctaHref}>{ctaLabel}</Link>
        </Button>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-[1.25rem] border border-white/10 bg-white/5 px-4 py-3 text-sm text-muted-foreground">
        <div className="flex flex-wrap items-center gap-2">
          <Link href="/" className="rounded-full border border-white/10 px-3 py-1.5 text-foreground transition hover:border-primary/30 hover:bg-primary/10">
            Home
          </Link>
          <Link
            href="/dashboard"
            className="rounded-full border border-white/10 px-3 py-1.5 text-foreground transition hover:border-primary/30 hover:bg-primary/10"
          >
            Dashboard
          </Link>
          <a
            href="https://docs.arc.network"
            target="_blank"
            rel="noreferrer"
            className="rounded-full border border-white/10 px-3 py-1.5 text-foreground transition hover:border-primary/30 hover:bg-primary/10"
          >
            Docs
          </a>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="warning">Active build</Badge>
          <span>Operator-facing preview with live Arc Testnet reads</span>
        </div>
      </div>
    </header>
  )
}
