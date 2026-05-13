#!/usr/bin/env node

import { randomBytes } from 'node:crypto'
import { mkdirSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import {
  initiateDeveloperControlledWalletsClient,
  registerEntitySecretCiphertext,
} from '@circle-fin/developer-controlled-wallets'

function readEnv(name) {
  return process.env[name]?.trim() || undefined
}

function readArg(name) {
  const flag = `--${name}`
  const index = process.argv.indexOf(flag)

  if (index === -1) {
    return undefined
  }

  const value = process.argv[index + 1]

  if (!value || value.startsWith('--')) {
    return undefined
  }

  return value
}

function generateEntitySecret() {
  return randomBytes(32).toString('hex')
}

async function main() {
  const apiKey = readArg('api-key') ?? readEnv('CIRCLE_API_KEY')
  const apiBase = readArg('api-base') ?? readEnv('CIRCLE_API_BASE') ?? 'https://api-sandbox.circle.com'
  const walletSetName = readArg('wallet-set-name') ?? readEnv('CIRCLE_WALLET_SET_NAME') ?? 'Arc Treasury Control Plane'
  const walletName = readArg('wallet-name') ?? readEnv('CIRCLE_WALLET_NAME') ?? 'Arc Treasury Operator'
  const recoveryDir = resolve(readArg('recovery-dir') ?? '/tmp/arc-circle-recovery')
  const entitySecret = readArg('entity-secret') ?? readEnv('CIRCLE_ENTITY_SECRET') ?? generateEntitySecret()

  if (!apiKey) {
    throw new Error('CIRCLE_API_KEY is required. Pass --api-key or set the environment variable.')
  }

  mkdirSync(recoveryDir, { recursive: true })

  const registration = await registerEntitySecretCiphertext({
    apiKey,
    baseUrl: apiBase,
    entitySecret,
    recoveryFileDownloadPath: recoveryDir,
  })

  const client = initiateDeveloperControlledWalletsClient({
    apiKey,
    baseUrl: apiBase,
    entitySecret,
  })

  const walletSetResponse = await client.createWalletSet({
    name: walletSetName,
  })

  const walletSet = walletSetResponse.data?.walletSet
  if (!walletSet?.id) {
    throw new Error('Circle wallet set creation did not return an ID.')
  }

  const walletsResponse = await client.createWallets({
    accountType: 'EOA',
    blockchains: ['ARC-TESTNET'],
    count: 1,
    metadata: [{ name: walletName, refId: walletName }],
    walletSetId: walletSet.id,
  })

  const wallet = walletsResponse.data?.wallets?.[0] ?? null
  const recoveryFiles = readdirSync(recoveryDir)

  const result = {
    apiBase,
    entitySecret,
    recoveryDir,
    recoveryFileCount: recoveryFiles.length,
    recoveryFileName: recoveryFiles[0] ?? null,
    recoveryFileResponse: registration.data?.recoveryFile ? 'returned' : 'missing',
    wallet: wallet
      ? {
          address: wallet.address ?? null,
          blockchain: wallet.blockchain ?? null,
          id: wallet.id ?? null,
          name: wallet.name ?? null,
        }
      : null,
    walletSet: {
      id: walletSet.id,
      name: walletSet.name ?? walletSetName,
    },
  }

  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
}

main().catch((error) => {
  const message = error instanceof Error ? error.message : 'Unknown Circle bootstrap error.'
  console.error(`Circle bootstrap failed: ${message}`)
  process.exitCode = 1
})
