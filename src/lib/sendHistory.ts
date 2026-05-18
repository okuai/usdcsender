import type { Address, Hex } from 'viem'

import type { ChainSlug } from '../config/chains'

export type SendHistoryStatus = 'idle' | 'pending' | 'sent' | 'failed'

export type SendHistoryRecord = {
  batchId: string
  batchIndex: number
  chainSlug: ChainSlug
  createdAt: string
  error?: string
  id: string
  recipientCount: number
  sender?: Address
  status: SendHistoryStatus
  totalRaw: string
  txHash?: Hex
  updatedAt: string
}

const dbName = 'usdc-sender-send-history'
const dbVersion = 1
const storeName = 'send-history'

export async function listSendHistory() {
  const db = await openSendHistoryDb()

  try {
    const records = await getAllRecords(db)
    return sortSendHistory(records)
  } finally {
    db.close()
  }
}

export async function upsertSendHistoryRecord(record: SendHistoryRecord) {
  const db = await openSendHistoryDb()

  try {
    await putRecord(db, record)
  } finally {
    db.close()
  }
}

export async function deleteSendHistoryRecord(id: string) {
  const db = await openSendHistoryDb()

  try {
    await deleteRecord(db, id)
  } finally {
    db.close()
  }
}

export function sortSendHistory(records: SendHistoryRecord[]) {
  return [...records].sort((left, right) =>
    right.updatedAt.localeCompare(left.updatedAt),
  )
}

function openSendHistoryDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    if (!globalThis.indexedDB) {
      reject(new Error('Send history database is unavailable'))
      return
    }

    const request = indexedDB.open(dbName, dbVersion)

    request.onerror = () =>
      reject(request.error ?? new Error('Failed to open send history database'))
    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(storeName)) {
        db.createObjectStore(storeName, { keyPath: 'id' })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

function getAllRecords(db: IDBDatabase) {
  const transaction = db.transaction(storeName, 'readonly')
  const store = transaction.objectStore(storeName)

  return requestToPromise<SendHistoryRecord[]>(store.getAll())
}

function putRecord(db: IDBDatabase, record: SendHistoryRecord) {
  const transaction = db.transaction(storeName, 'readwrite')
  const store = transaction.objectStore(storeName)

  store.put(record)
  return transactionToPromise(transaction)
}

function deleteRecord(db: IDBDatabase, id: string) {
  const transaction = db.transaction(storeName, 'readwrite')
  const store = transaction.objectStore(storeName)

  store.delete(id)
  return transactionToPromise(transaction)
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error('Send history operation failed'))
    request.onsuccess = () => resolve(request.result)
  })
}

function transactionToPromise(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Send history operation failed'))
    transaction.oncomplete = () => resolve()
  })
}
