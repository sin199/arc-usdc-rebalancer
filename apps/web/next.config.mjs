import path from 'node:path'

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@arc-usdc-rebalancer/shared', '@circle-fin/developer-controlled-wallets'],
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  env: {
    ARC_TESTNET_RPC_URL: process.env.ARC_TESTNET_RPC_URL,
    TREASURY_POLICY_ADDRESS: process.env.TREASURY_POLICY_ADDRESS,
    TREASURY_EXECUTOR_ADDRESS: process.env.TREASURY_EXECUTOR_ADDRESS,
  },
}

export default nextConfig
