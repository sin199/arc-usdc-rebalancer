import Image from 'next/image'
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
    <header className="mx-auto flex w-full max-w-screen-2xl items-center justify-between gap-4 px-4 py-6 sm:px-6 lg:px-8">
      <div className="flex items-center gap-3">
        <Image src="/logo.svg" alt="Arc USDC Rebalancer logo" width={44} height={44} className="h-11 w-11 shrink-0" />
        <div>
          <Badge variant="outline" className="mb-2 border-primary/25 bg-primary/10 text-primary">
            {eyebrow}
          </Badge>
          <h1 className="font-display text-xl font-semibold tracking-tight">{title}</h1>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      <Button asChild variant="outline" className="shrink-0 px-3 sm:px-4">
        <Link href={ctaHref}>{ctaLabel}</Link>
      </Button>
    </header>
  )
}
