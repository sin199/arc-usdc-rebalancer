import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveArcAgentRecommendation } from '../lib/arc-agent-server'

const readyCircle = {
  apiKeyConfigured: true,
  entitySecretConfigured: true,
  gatewayConfigured: true,
  walletBlockchainConfigured: true,
  walletSetConfigured: true,
}

test('configured policy with unavailable data never reports a healthy hold', () => {
  const recommendation = deriveArcAgentRecommendation({
    balanceUsdc: null,
    circleAvailable: true,
    circleNotes: [],
    circleReadiness: readyCircle,
    evaluation: null,
    executorAddress: '0x0000000000000000000000000000000000000002',
    policy: null,
    policyAddress: '0x0000000000000000000000000000000000000001',
  })

  assert.equal(recommendation.action, 'load_policy')
  assert.match(recommendation.headline, /unavailable/i)
  assert.match(recommendation.detail, /No move should be executed/i)
})
