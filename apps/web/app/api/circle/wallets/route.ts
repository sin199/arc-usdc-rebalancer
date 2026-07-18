import { NextRequest, NextResponse } from 'next/server'
import {
  createCircleWallet,
  getCircleReadiness,
  getCircleServerConfig,
} from '@/lib/circle-server'
import { hashLiveExecutionPayload } from '@/lib/live-execution-auth'
import {
  auditLiveExecution,
  authorizeLiveExecution,
} from '@/lib/live-execution-guard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json().catch(() => ({}))) as Record<
      string,
      unknown
    >
    const config = getCircleServerConfig()
    const readiness = getCircleReadiness()
    const operatorAddress =
      typeof body.operatorAddress === 'string'
        ? body.operatorAddress.trim()
        : ''
    const requestId =
      typeof body.requestId === 'string' ? body.requestId.trim() : ''
    const timestamp = Number(body.timestamp)

    const walletRequest = {
      accountType:
        body.accountType === 'SCA' ? ('SCA' as const) : ('EOA' as const),
      blockchain:
        body.blockchain === 'ARC-TESTNET'
          ? ('ARC-TESTNET' as const)
          : config.walletBlockchain,
      walletName:
        typeof body.walletName === 'string' && body.walletName.trim()
          ? body.walletName.trim()
          : null,
      walletSetId:
        typeof body.walletSetId === 'string' && body.walletSetId.trim()
          ? body.walletSetId.trim()
          : null,
      walletSetName:
        typeof body.walletSetName === 'string' && body.walletSetName.trim()
          ? body.walletSetName.trim()
          : null,
    }
    const authorization = await authorizeLiveExecution(request, {
      kind: 'create_circle_wallet',
      operatorAddress,
      payloadHash: hashLiveExecutionPayload(walletRequest),
      requestId,
      timestamp,
    })

    if (!authorization.ok) {
      return authorization.response
    }

    if (!readiness.apiKeyConfigured || !readiness.entitySecretConfigured) {
      return NextResponse.json(
        {
          error: 'Circle developer wallet secrets are not configured.',
          missing: [
            !readiness.apiKeyConfigured ? 'CIRCLE_API_KEY' : null,
            !readiness.entitySecretConfigured ? 'CIRCLE_ENTITY_SECRET' : null,
          ].filter((value): value is string => Boolean(value)),
        },
        {
          headers: {
            'cache-control': 'no-store',
            'x-request-id': authorization.authorization.requestId,
          },
          status: 400,
        },
      )
    }

    const createdWallet = await createCircleWallet({
      accountType: walletRequest.accountType,
      blockchain: walletRequest.blockchain,
      walletName: walletRequest.walletName ?? config.walletName,
      walletSetId: walletRequest.walletSetId ?? undefined,
      walletSetName: walletRequest.walletSetName ?? config.walletSetName,
    })

    auditLiveExecution('circle_wallet_created', {
      requestId: authorization.authorization.requestId,
      walletSetId: createdWallet.walletSetId,
    })

    return NextResponse.json(createdWallet, {
      headers: {
        'cache-control': 'no-store',
        'x-request-id': authorization.authorization.requestId,
      },
    })
  } catch (error) {
    const message =
      error instanceof Error
        ? error.message
        : 'Unknown Circle wallet creation error.'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
