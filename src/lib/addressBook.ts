import { getAddress, parseUnits, zeroAddress } from 'viem'
import type { Address } from 'viem'

import type { ChainSlug } from '../config/chains'

export type AddressBookRecipient = {
  address: Address
  amount: string
}

export type AddressBookRecord = {
  chainSlug: ChainSlug
  createdAt: string
  fingerprint: string
  id: string
  name: string
  recipients: AddressBookRecipient[]
  updatedAt: string
}

export type AddressBookDraft = {
  chainSlug: ChainSlug
  name: string
  recipients: AddressBookRecipient[]
}

const dbName = 'usdc-sender-address-books'
const dbVersion = 1
const storeName = 'address-books'
const fingerprintIndexName = 'fingerprint'

export async function requestAddressBookPersistence() {
  if (!navigator.storage?.persist) {
    return false
  }

  try {
    return await navigator.storage.persist()
  } catch {
    return false
  }
}

export async function listAddressBooks() {
  const db = await openAddressBookDb()

  try {
    const books = await getAllBooks(db)
    return books.sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
  } finally {
    db.close()
  }
}

export async function createAddressBook(draft: AddressBookDraft) {
  const result = await createAddressBookIfMissing(draft)

  if (!result.created) {
    throw new Error(`An address book with the same data already exists: ${result.book.name}`)
  }

  return result.book
}

export async function createAddressBookIfMissing(draft: AddressBookDraft) {
  const db = await openAddressBookDb()

  try {
    const normalized = normalizeDraft(draft)
    const duplicate = await getBookByFingerprint(db, normalized.fingerprint)

    if (duplicate) {
      return {
        book: duplicate,
        created: false,
      }
    }

    const now = new Date().toISOString()
    const book: AddressBookRecord = {
      ...normalized,
      createdAt: now,
      id: createRecordId(),
      updatedAt: now,
    }

    await addBook(db, book)
    return {
      book,
      created: true,
    }
  } finally {
    db.close()
  }
}

export async function updateAddressBook(id: string, draft: AddressBookDraft) {
  const db = await openAddressBookDb()

  try {
    const existing = await getBookById(db, id)

    if (!existing) {
      throw new Error('Address book not found')
    }

    const normalized = normalizeDraft(draft)
    const duplicate = await getBookByFingerprint(db, normalized.fingerprint)

    if (duplicate && duplicate.id !== id) {
      throw new Error(`An address book with the same data already exists: ${duplicate.name}`)
    }

    const next: AddressBookRecord = {
      createdAt: existing.createdAt,
      id: existing.id,
      ...normalized,
      updatedAt: new Date().toISOString(),
    }

    await putBook(db, next)
    return next
  } finally {
    db.close()
  }
}

export async function deleteAddressBook(id: string) {
  const db = await openAddressBookDb()

  try {
    await deleteBook(db, id)
  } finally {
    db.close()
  }
}

export function addressBookToCsv(book: AddressBookRecord) {
  return [
    'address,amount',
    ...book.recipients.map((recipient) =>
      [recipient.address, recipient.amount].map(csvCell).join(','),
    ),
  ].join('\n')
}

function normalizeDraft(draft: AddressBookDraft) {
  const name = draft.name.trim()
  const recipients = draft.recipients.map(normalizeRecipient)

  if (!name) {
    throw new Error('Address book name is required')
  }

  if (recipients.length === 0) {
    throw new Error('Address book needs at least 1 recipient')
  }

  return {
    chainSlug: draft.chainSlug,
    fingerprint: createFingerprint(draft.chainSlug, recipients),
    name,
    recipients,
  }
}

function normalizeRecipient(recipient: AddressBookRecipient) {
  const address = getAddress(recipient.address)
  const amount = normalizeAmount(recipient.amount)

  if (address === zeroAddress) {
    throw new Error('Recipient address cannot be the zero address')
  }

  return {
    address,
    amount,
  }
}

function normalizeAmount(value: string) {
  const trimmed = value.trim()
  const raw = parseUnits(trimmed, 6)

  if (raw <= 0n) {
    throw new Error('Amount must be greater than 0')
  }

  return formatAmount(raw)
}

function createFingerprint(
  chainSlug: ChainSlug,
  recipients: AddressBookRecipient[],
) {
  const normalizedRows = recipients
    .map((recipient) => {
      const amountRaw = parseUnits(recipient.amount, 6)
      return `${recipient.address.toLowerCase()}:${amountRaw.toString()}`
    })
    .sort()

  return hashString(`${chainSlug}|${normalizedRows.join('|')}`)
}

function formatAmount(raw: bigint) {
  const whole = raw / 1_000_000n
  const fraction = raw % 1_000_000n

  if (fraction === 0n) {
    return whole.toString()
  }

  return `${whole}.${fraction.toString().padStart(6, '0').replace(/0+$/, '')}`
}

function openAddressBookDb() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open(dbName, dbVersion)

    request.onerror = () => reject(request.error ?? new Error('Failed to open address book database'))
    request.onupgradeneeded = () => {
      const db = request.result

      if (!db.objectStoreNames.contains(storeName)) {
        const store = db.createObjectStore(storeName, { keyPath: 'id' })
        store.createIndex(fingerprintIndexName, fingerprintIndexName, {
          unique: true,
        })
      }
    }
    request.onsuccess = () => resolve(request.result)
  })
}

function getAllBooks(db: IDBDatabase) {
  const transaction = db.transaction(storeName, 'readonly')
  const store = transaction.objectStore(storeName)

  return requestToPromise<AddressBookRecord[]>(store.getAll())
}

function getBookById(db: IDBDatabase, id: string) {
  const transaction = db.transaction(storeName, 'readonly')
  const store = transaction.objectStore(storeName)

  return requestToPromise<AddressBookRecord | undefined>(store.get(id))
}

function getBookByFingerprint(db: IDBDatabase, fingerprint: string) {
  const transaction = db.transaction(storeName, 'readonly')
  const store = transaction.objectStore(storeName)
  const index = store.index(fingerprintIndexName)

  return requestToPromise<AddressBookRecord | undefined>(index.get(fingerprint))
}

function addBook(db: IDBDatabase, book: AddressBookRecord) {
  const transaction = db.transaction(storeName, 'readwrite')
  const store = transaction.objectStore(storeName)

  store.add(book)
  return transactionToPromise(transaction)
}

function putBook(db: IDBDatabase, book: AddressBookRecord) {
  const transaction = db.transaction(storeName, 'readwrite')
  const store = transaction.objectStore(storeName)

  store.put(book)
  return transactionToPromise(transaction)
}

function deleteBook(db: IDBDatabase, id: string) {
  const transaction = db.transaction(storeName, 'readwrite')
  const store = transaction.objectStore(storeName)

  store.delete(id)
  return transactionToPromise(transaction)
}

function requestToPromise<T>(request: IDBRequest<T>) {
  return new Promise<T>((resolve, reject) => {
    request.onerror = () => reject(request.error ?? new Error('Address book operation failed'))
    request.onsuccess = () => resolve(request.result)
  })
}

function transactionToPromise(transaction: IDBTransaction) {
  return new Promise<void>((resolve, reject) => {
    transaction.onerror = () =>
      reject(transaction.error ?? new Error('Address book operation failed'))
    transaction.oncomplete = () => resolve()
  })
}

function csvCell(value: string) {
  if (!/[",\n]/.test(value)) {
    return value
  }

  return `"${value.replaceAll('"', '""')}"`
}

function createRecordId() {
  const browserCrypto = globalThis.crypto

  if (browserCrypto?.randomUUID) {
    return browserCrypto.randomUUID()
  }

  const bytes = new Uint8Array(16)

  if (browserCrypto?.getRandomValues) {
    browserCrypto.getRandomValues(bytes)
  } else {
    for (let index = 0; index < bytes.length; index++) {
      bytes[index] = Math.floor(Math.random() * 256)
    }
  }

  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0'))

  return [
    hex.slice(0, 4).join(''),
    hex.slice(4, 6).join(''),
    hex.slice(6, 8).join(''),
    hex.slice(8, 10).join(''),
    hex.slice(10, 16).join(''),
  ].join('-')
}

function hashString(input: string) {
  let hash = 5381

  for (let index = 0; index < input.length; index++) {
    hash = Math.imul(hash, 33) ^ input.charCodeAt(index)
  }

  return Math.abs(hash).toString(36)
}
