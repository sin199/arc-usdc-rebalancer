import type { Metadata } from 'next'
import { Manrope, Space_Grotesk } from 'next/font/google'
import type { ReactNode } from 'react'
import { Providers } from './providers'
import './globals.css'

const display = Space_Grotesk({
  subsets: ['latin'],
  variable: '--font-display',
})

const body = Manrope({
  subsets: ['latin'],
  variable: '--font-body',
})

export const metadata: Metadata = {
  title: 'Arc USDC Rebalancer · Architects packet',
  description:
    'A public Arc Testnet treasury review packet with copyable reports, live operator gating, and visible build notes.',
}

export default function RootLayout({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en" className={`${display.variable} ${body.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  )
}
