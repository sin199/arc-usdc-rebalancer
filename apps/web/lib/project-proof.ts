import {
  arcTestnetChainId,
  arcTestnetExplorerUrl,
} from '@arc-usdc-rebalancer/shared'
import {
  arcAgentId,
  arcAgentIdentityRegistryAddress,
  arcAgentReputationRegistryAddress,
  arcAgentValidationRegistryAddress,
  arcAgentValidationTag,
} from '@/lib/arc-agent'

export const projectProof = {
  productionUrl: 'https://web-eight-chi-99.vercel.app',
  latestDeploymentUrl: process.env.VERCEL_URL?.trim()
    ? `https://${process.env.VERCEL_URL.trim()}`
    : 'local development',
  deploymentHash:
    process.env.VERCEL_DEPLOYMENT_ID?.trim() ?? 'local-development',
  mainBranch: process.env.VERCEL_GIT_COMMIT_REF?.trim() ?? 'main',
  mainCommit: process.env.VERCEL_GIT_COMMIT_SHA?.trim() ?? 'local-development',
  githubRepoUrl: 'https://github.com/sin199/arc-usdc-rebalancer',
  arcTestnetChainId,
  arcTestnetExplorerUrl,
  treasuryPolicyAddress: '0x4bFa1e67B1163B452d39f27F799B0A7D28F545f6',
  treasuryExecutorAddress: '0x5c5d0275371724779f3a6928eb0312df2b1a501f',
  usdcAddress: '0x3600000000000000000000000000000000000000',
  agentId: arcAgentId.toString(),
  agentStatus: arcAgentValidationTag,
  currentOnchainProofStatus: {
    label: 'Not yet published',
    summary:
      'The public demo proves the report-first readiness flow and the locked execution boundary. No top_up or trim Arc Testnet tx hash is published yet, and no gates were bypassed.',
    details: [
      'Report-first output is visible without a wallet.',
      'Action pack templates are visible while live execution stays locked.',
      'A future live deployment would require an operator wallet, live policy, Circle wallet-set readiness, and executor configuration.',
      'Circle readiness is optional for the current proof and only becomes required for live crosschain execution.',
    ],
  },
  safetyBoundaries: [
    'Do not paste real private keys into the browser.',
    'The site does not collect private keys.',
    'No silent transactions are sent from preview mode.',
    'No live execution runs without the existing operator gates.',
    'The demo is report-first, execution-second, and not a profit bot.',
  ],
  screenshotChecklist: [
    'Homepage hero with the 30-second visitor path.',
    'Dashboard at target / hold.',
    'Dashboard below minimum / top_up.',
    'Dashboard above target / trim.',
    'Dashboard execution locked state.',
  ],
  arcscanLinks: [
    {
      label: 'TreasuryPolicy',
      href: `${arcTestnetExplorerUrl}/address/0x4bFa1e67B1163B452d39f27F799B0A7D28F545f6`,
      value: '0x4bFa1e67B1163B452d39f27F799B0A7D28F545f6',
    },
    {
      label: 'TreasuryExecutor',
      href: `${arcTestnetExplorerUrl}/address/0x5c5d0275371724779f3a6928eb0312df2b1a501f`,
      value: '0x5c5d0275371724779f3a6928eb0312df2b1a501f',
    },
    {
      label: 'USDC token',
      href: `${arcTestnetExplorerUrl}/address/0x3600000000000000000000000000000000000000`,
      value: '0x3600000000000000000000000000000000000000',
    },
    {
      label: 'Agent identity registry',
      href: `${arcTestnetExplorerUrl}/address/${arcAgentIdentityRegistryAddress}`,
      value: `${arcAgentId.toString()} / ${arcAgentValidationTag}`,
    },
    {
      label: 'Agent reputation registry',
      href: `${arcTestnetExplorerUrl}/address/${arcAgentReputationRegistryAddress}`,
      value: arcAgentReputationRegistryAddress,
    },
    {
      label: 'Agent validation registry',
      href: `${arcTestnetExplorerUrl}/address/${arcAgentValidationRegistryAddress}`,
      value: arcAgentValidationRegistryAddress,
    },
  ],
}
