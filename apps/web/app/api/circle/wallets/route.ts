import { NextRequest, NextResponse } from 'next/server'
import { createCircleWallet, getCircleReadiness, getCircleServerConfig } from '@/lib/circle-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>
    const config = getCircleServerConfig()
    const readiness = getCircleReadiness()

    if (!readiness.apiKeyConfigured || !readiness.entitySecretConfigured) {
      return NextResponse.json(
        {
          error: 'Circle developer wallet secrets are not configured.',
          missing: [
            !readiness.apiKeyConfigured ? 'CIRCLE_API_KEY' : null,
            !readiness.entitySecretConfigured ? 'CIRCLE_ENTITY_SECRET' : null,
          ].filter((value): value is string => Boolean(value)),
        },
        { status: 400 },
      )
    }
    const blockchain =
      body.blockchain === 'ARC-TESTNET' ? 'ARC-TESTNET' : config.walletBlockchain

    const createdWallet = await createCircleWallet({
      accountType: body.accountType === 'SCA' ? 'SCA' : 'EOA',
      blockchain,
      walletName: typeof body.walletName === 'string' && body.walletName.trim() ? body.walletName.trim() : config.walletName,
      walletSetId: typeof body.walletSetId === 'string' && body.walletSetId.trim() ? body.walletSetId.trim() : undefined,
      walletSetName: typeof body.walletSetName === 'string' && body.walletSetName.trim() ? body.walletSetName.trim() : config.walletSetName,
    })

    return NextResponse.json(createdWallet, {
      headers: {
        'cache-control': 'no-store',
      },
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Circle wallet creation error.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
