import type { Metadata } from 'next'
import { ReadinessChecker } from '@/components/readiness-checker'

export const metadata: Metadata = {
  title: 'Check your USDC treasury · Arc USDC Rebalancer',
  description: 'Get a clear Hold, Top up, Trim, or Review decision with an auditable Arc Testnet readiness report.',
}

export default function DashboardPage() {
  return <ReadinessChecker />
}
