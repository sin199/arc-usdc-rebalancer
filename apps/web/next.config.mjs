import path from 'node:path'

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@arc-usdc-rebalancer/shared'],
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
  env: {
    ARC_TESTNET_RPC_URL: process.env.ARC_TESTNET_RPC_URL,
    TREASURY_POLICY_ADDRESS: process.env.TREASURY_POLICY_ADDRESS,
    NEXT_PUBLIC_EXECUTION_API_URL: process.env.NEXT_PUBLIC_EXECUTION_API_URL,
  },
}

export default nextConfig
