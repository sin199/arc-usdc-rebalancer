import { defineChain, http, type Address } from 'viem'
import { createConfig, injected } from 'wagmi'
import {
  arcTestnetChainId,
  arcTestnetExplorerUrl,
  arcTestnetRpcUrl,
  arcUsdcDecimals,
} from '@arc-usdc-rebalancer/shared'

export const arcTestnet = defineChain({
  id: arcTestnetChainId,
  name: 'Arc Testnet',
  nativeCurrency: {
    name: 'USDC',
    symbol: 'USDC',
    decimals: arcUsdcDecimals,
  },
  rpcUrls: {
    default: {
      http: [arcTestnetRpcUrl],
    },
  },
  blockExplorers: {
    default: {
      name: 'Arc Scan',
      url: arcTestnetExplorerUrl,
    },
  },
})

export const wagmiConfig = createConfig({
  chains: [arcTestnet],
  connectors: [injected({ shimDisconnect: true })],
  transports: {
    [arcTestnet.id]: http(arcTestnetRpcUrl),
  },
  ssr: true,
})

export type WalletAddress = Address
