import { encodeAbiParameters, keccak256 } from 'viem'
import type { Address, Hex } from 'viem'

import { appChains } from '../config/chains'
import type { ChainSlug } from '../config/chains'
import type { RecipientRow } from './csv'

export type PreparedBatch = {
  amounts: bigint[]
  batchId: Hex
  chainSlug: ChainSlug
  endLine: number
  id: string
  index: number
  recipients: Address[]
  rows: RecipientRow[]
  startLine: number
  totalRaw: bigint
}

export function buildBatches(
  rows: RecipientRow[],
  batchSizes: Record<ChainSlug, number>,
) {
  return appChains.flatMap((chain) => {
    const chainRows = rows.filter((row) => row.chainSlug === chain.slug)
    const batchSize = Math.max(
      1,
      batchSizes[chain.slug] ?? chain.defaultBatchSize,
    )
    const batches: PreparedBatch[] = []

    for (let start = 0; start < chainRows.length; start += batchSize) {
      const batchRows = chainRows.slice(start, start + batchSize)
      const index = batches.length + 1
      const totalRaw = batchRows.reduce((total, row) => total + row.amountRaw, 0n)
      const recipients = batchRows.map((row) => row.address)
      const amounts = batchRows.map((row) => row.amountRaw)
      const batchId = createFrontendBatchId(
        chain.slug,
        index,
        recipients,
        amounts,
      )

      batches.push({
        amounts,
        batchId,
        chainSlug: chain.slug,
        endLine: batchRows.at(-1)?.line ?? 0,
        id: batchId,
        index,
        recipients,
        rows: batchRows,
        startLine: batchRows[0]?.line ?? 0,
        totalRaw,
      })
    }

    return batches
  })
}

function createFrontendBatchId(
  chainSlug: ChainSlug,
  batchIndex: number,
  recipients: Address[],
  amounts: bigint[],
) {
  return keccak256(
    encodeAbiParameters(
      [
        { name: 'chainSlug', type: 'string' },
        { name: 'batchIndex', type: 'uint256' },
        { name: 'recipients', type: 'address[]' },
        { name: 'amounts', type: 'uint256[]' },
      ],
      [chainSlug, BigInt(batchIndex), recipients, amounts],
    ),
  )
}
