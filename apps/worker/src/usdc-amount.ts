import { formatUnits, parseUnits } from 'viem'

const USDC_DECIMALS = 6

export type ParsedWorkerUsdcAmount = {
  amountUsdc: number
  amountUnits: bigint
  canonical: string
}

export function parseWorkerUsdcAmount(
  value: unknown,
  label = 'USDC amount',
  allowZero = false,
): ParsedWorkerUsdcAmount {
  const raw =
    typeof value === 'number'
      ? String(value)
      : typeof value === 'string'
        ? value.trim()
        : ''

  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(raw)) {
    throw new Error(
      `${label} must be a decimal amount with at most 6 fractional digits.`,
    )
  }

  const amountUnits = parseUnits(raw, USDC_DECIMALS)
  if (amountUnits < 0n || (!allowZero && amountUnits === 0n)) {
    throw new Error(`${label} must be greater than zero.`)
  }

  const canonical = formatUnits(amountUnits, USDC_DECIMALS)
  const amountUsdc = Number(canonical)
  if (!Number.isFinite(amountUsdc)) {
    throw new Error(`${label} is outside the supported numeric range.`)
  }

  return { amountUsdc, amountUnits, canonical }
}
