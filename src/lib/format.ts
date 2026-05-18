import { formatUnits } from 'viem'

export function formatUsdc(value?: bigint) {
  if (value === undefined) {
    return '-'
  }

  const formatted = formatUnits(value, 6)
  return trimTrailingZeros(formatted)
}

export function shortAddress(value: string) {
  return `${value.slice(0, 6)}...${value.slice(-4)}`
}

export function sumBigints(values: bigint[]) {
  return values.reduce((total, value) => total + value, 0n)
}

function trimTrailingZeros(value: string) {
  if (!value.includes('.')) {
    return value
  }

  return value.replace(/\.?0+$/, '')
}
