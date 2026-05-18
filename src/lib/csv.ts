import { getAddress, isAddress, parseUnits, zeroAddress } from 'viem'
import type { Address } from 'viem'

import type { ChainSlug } from '../config/chains'

export type RecipientRow = {
  address: Address
  amount: string
  amountRaw: bigint
  chainSlug: ChainSlug
  id: string
  line: number
}

export type CsvIssue = {
  level: 'error' | 'warning'
  line: number
  message: string
  raw: string
}

export type ParseResult = {
  issues: CsvIssue[]
  rows: RecipientRow[]
}

const amountPattern = /^(0|[1-9]\d*)(\.\d{1,6})?$/

export function parseRecipientsCsv(
  input: string,
  chainSlug: ChainSlug,
): ParseResult {
  const issues: CsvIssue[] = []
  const rows: RecipientRow[] = []
  const seen = new Set<string>()

  input
    .split(/\r?\n/)
    .map((raw, index) => ({ line: index + 1, raw }))
    .filter(({ raw }) => raw.trim().length > 0)
    .forEach(({ line, raw }, visibleIndex) => {
      const cells = splitCsvLine(raw).map((cell) => cell.trim())

      if (visibleIndex === 0 && isHeader(cells)) {
        return
      }

      if (visibleIndex === 0 && isLegacyHeader(cells)) {
        issues.push({
          level: 'error',
          line,
          message: 'Remove the chain column; select the target chain from the network selector',
          raw,
        })
        return
      }

      if (cells.length !== 2) {
        issues.push({
          level: 'error',
          line,
          message: 'Expected address,amount columns; the target chain comes from the network selector',
          raw,
        })
        return
      }

      if (!isAddress(cells[0])) {
        issues.push({
          level: 'error',
          line,
          message: 'Recipient address is not a valid EVM address',
          raw,
        })
        return
      }

      if (!amountPattern.test(cells[1])) {
        issues.push({
          level: 'error',
          line,
          message: 'Amount must be greater than 0 and use at most 6 decimal places',
          raw,
        })
        return
      }

      const amountRaw = parseUnits(cells[1], 6)
      if (amountRaw === 0n) {
        issues.push({
          level: 'error',
          line,
          message: 'Amount must be greater than 0',
          raw,
        })
        return
      }

      const address = getAddress(cells[0])
      if (address === zeroAddress) {
        issues.push({
          level: 'error',
          line,
          message: 'Recipient address cannot be the zero address',
          raw,
        })
        return
      }

      const duplicateKey = `${chainSlug}:${address}:${amountRaw.toString()}`

      if (seen.has(duplicateKey)) {
        issues.push({
          level: 'warning',
          line,
          message: 'Duplicate row detected; it will be treated as a separate recipient',
          raw,
        })
      }

      seen.add(duplicateKey)
      rows.push({
        address,
        amount: cells[1],
        amountRaw,
        chainSlug,
        id: stableRowId(line, duplicateKey),
        line,
      })
    })

  return { issues, rows }
}

function isHeader(cells: string[]) {
  return (
    cells.length === 2 &&
    cells[0]?.toLowerCase() === 'address' &&
    cells[1]?.toLowerCase() === 'amount'
  )
}

function isLegacyHeader(cells: string[]) {
  return (
    cells.length >= 3 &&
    cells[0]?.toLowerCase() === 'chain' &&
    cells[1]?.toLowerCase() === 'address' &&
    cells[2]?.toLowerCase() === 'amount'
  )
}

function splitCsvLine(line: string) {
  const cells: string[] = []
  let cell = ''
  let quoted = false

  for (let index = 0; index < line.length; index++) {
    const char = line[index]
    const next = line[index + 1]

    if (char === '"' && quoted && next === '"') {
      cell += '"'
      index++
      continue
    }

    if (char === '"') {
      quoted = !quoted
      continue
    }

    if ((char === ',' || char === '\t') && !quoted) {
      cells.push(cell)
      cell = ''
      continue
    }

    cell += char
  }

  cells.push(cell)
  return cells
}

function stableRowId(line: number, key: string) {
  let hash = 0

  for (let index = 0; index < key.length; index++) {
    hash = Math.imul(31, hash) + key.charCodeAt(index)
  }

  return `${line}-${Math.abs(hash)}`
}
