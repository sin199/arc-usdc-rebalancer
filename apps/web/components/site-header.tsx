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
    <header className="mx-auto flex w-full max-w-6xl items-center justify-between gap-4 px-4 py-6 sm:px-6 lg:px-8">
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
    </header>
  )
}
