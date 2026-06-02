import type { Metadata } from 'next'
import { ReadinessChecker } from '@/components/readiness-checker'

export const metadata: Metadata = {
  title: 'Arc USDC Rebalancer · verified demo',
  description:
    'A verified Arc Testnet treasury demo with a copyable report, an architect proof page, and operator-gated execution.',
}

export default function DashboardPage() {
  return <ReadinessChecker />
}
