import type { Metadata } from 'next'
import { ReadinessChecker } from '@/components/readiness-checker'

export const metadata: Metadata = {
  title: 'Arc USDC Rebalancer · readiness checker',
  description:
    'A live Arc Testnet treasury readiness checker with a copyable report and operator-gated execution.',
}

export default function DashboardPage() {
  return <ReadinessChecker />
}
