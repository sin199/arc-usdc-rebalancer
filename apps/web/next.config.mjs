import path from 'node:path'

/** @type {import('next').NextConfig} */
const nextConfig = {
  transpilePackages: ['@arc-usdc-rebalancer/shared'],
  outputFileTracingRoot: path.join(process.cwd(), '../..'),
}

export default nextConfig
