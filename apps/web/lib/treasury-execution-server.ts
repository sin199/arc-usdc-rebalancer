import {
  createPublicClient,
  createWalletClient,
  defineChain,
  getContract,
  http,
  parseUnits,
  type Address,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import {
  arcTestnetChainId,
  arcTestnetExplorerUrl,
  arcUsdcAddress,
  arcUsdcDecimals,
  erc20ContractAbi,
  formatUsdc,
  treasuryExecutorContractAbi,
} from '@arc-usdc-rebalancer/shared'
import { arcTestnetRpcUrl } from './treasury-policy'
import { treasuryExecutorAddressConfig } from './treasury-executor'

const arcTestnet = defineChain({
  id: arcTestnetChainId,
  name: 'Arc Testnet',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: arcUsdcDecimals,
  },
  rpcUrls: {
    default: { http: [arcTestnetRpcUrl] },
    public: { http: [arcTestnetRpcUrl] },
  },
  blockExplorers: {
    default: {
      name: 'Arc Scan',
      url: arcTestnetExplorerUrl,
    },
  },
})

export type TreasuryExecutionAction = 'top_up' | 'trim'

export type TreasuryExecutionResult = {
  action: TreasuryExecutionAction
  amountUsdc: number
  executorAddress: `0x${string}`
  ownerAddress: `0x${string}`
  recipient?: `0x${string}`
  txHashes: {
    approve?: `0x${string}`
    execute: `0x${string}`
  }
  summary: string
  mode: 'server'
}

function readEnv(name: string) {
  return process.env[name]?.trim() || undefined
}

function requirePrivateKey(name: string): `0x${string}` {
  const value = readEnv(name)

  if (!value) {
    throw new Error(`${name} is missing.`)
  }

  if (!value.startsWith('0x') || value.length !== 66) {
    throw new Error(`${name} must be a 0x-prefixed 32-byte private key.`)
  }

  return value as `0x${string}`
}

function createTreasuryExecutionClients() {
  const ownerAccount = privateKeyToAccount(requirePrivateKey('OWNER_PRIVATE_KEY'))

  const publicClient = createPublicClient({
    chain: arcTestnet,
    transport: http(arcTestnetRpcUrl),
  })

  const walletClient = createWalletClient({
    account: ownerAccount,
    chain: arcTestnet,
    transport: http(arcTestnetRpcUrl),
  })

  return {
    ownerAccount,
    publicClient,
    walletClient,
  }
}

async function waitForReceipt(publicClient: ReturnType<typeof createPublicClient>, hash: `0x${string}`) {
  return publicClient.waitForTransactionReceipt({
    hash,
    pollingInterval: 1000,
  })
}

export async function runTreasuryExecution(params: {
  action: TreasuryExecutionAction
  amountUsdc: number
  recipient?: Address
}): Promise<TreasuryExecutionResult> {
  const executorAddress = treasuryExecutorAddressConfig.address

  if (!executorAddress) {
    throw new Error('TREASURY_EXECUTOR_ADDRESS is missing.')
  }

  const amountUnits = parseUnits(String(params.amountUsdc), arcUsdcDecimals)

  if (amountUnits <= 0n) {
    throw new Error('Execution amount must be greater than zero.')
  }

  const { ownerAccount, publicClient, walletClient } = createTreasuryExecutionClients()
  const executorContract = getContract({
    address: executorAddress,
    abi: treasuryExecutorContractAbi,
    client: publicClient,
  })

  const executorOwner = await executorContract.read.owner()

  if (executorOwner.toLowerCase() !== ownerAccount.address.toLowerCase()) {
    throw new Error(
      `TreasuryExecutor owner mismatch. Expected ${ownerAccount.address}, found ${executorOwner}.`,
    )
  }

  if (params.action === 'top_up') {
    const approveHash = await walletClient.writeContract({
      address: arcUsdcAddress,
      abi: erc20ContractAbi,
      functionName: 'approve',
      args: [executorAddress, amountUnits],
    })

    await waitForReceipt(publicClient, approveHash)

    const executeHash = await walletClient.writeContract({
      address: executorAddress,
      abi: treasuryExecutorContractAbi,
      functionName: 'executeTopUp',
      args: [amountUnits],
    })

    await waitForReceipt(publicClient, executeHash)

    return {
      action: params.action,
      amountUsdc: params.amountUsdc,
      executorAddress,
      ownerAddress: ownerAccount.address,
      txHashes: {
        approve: approveHash,
        execute: executeHash,
      },
      summary: `Top-up confirmed via the server signer. ${formatUsdc(params.amountUsdc)} USDC moved into TreasuryExecutor.`,
      mode: 'server',
    }
  }

  const recipient = params.recipient ?? ownerAccount.address
  const executeHash = await walletClient.writeContract({
    address: executorAddress,
    abi: treasuryExecutorContractAbi,
    functionName: 'executeTrim',
    args: [recipient, amountUnits],
  })

  await waitForReceipt(publicClient, executeHash)

  return {
    action: params.action,
    amountUsdc: params.amountUsdc,
    executorAddress,
    ownerAddress: ownerAccount.address,
    recipient,
    txHashes: {
      execute: executeHash,
    },
    summary: `Trim confirmed via the server signer. ${formatUsdc(params.amountUsdc)} USDC moved back to the owner wallet.`,
    mode: 'server',
  }
}
