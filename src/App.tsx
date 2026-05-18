import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { CSSProperties, ChangeEvent, ReactNode } from 'react'
import {
  AlertTriangle,
  BookOpen,
  ChevronDown,
  CheckCircle2,
  CircleDollarSign,
  Download,
  ExternalLink,
  FileCheck2,
  Loader2,
  Pencil,
  RefreshCcw,
  Save,
  Search,
  Send,
  ShieldCheck,
  Trash2,
  Upload,
  WalletCards,
  XCircle,
} from 'lucide-react'
import {
  getPublicClient,
  readContract,
  waitForTransactionReceipt,
  writeContract,
} from 'wagmi/actions'
import { AppKitButton, useAppKitNetwork } from '@reown/appkit/react'
import { useAccount } from 'wagmi'
import { getAddress, keccak256, parseUnits } from 'viem'
import type { Address, Hex } from 'viem'

import './App.css'
import heroImage from './assets/hero.png'
import {
  appChains,
  createxFactoryAddress,
  defaultChainSlug,
  getChainConfig,
  getChainConfigById,
  isConfiguredAddress,
  wagmiConfig,
} from './config/chains'
import type { ChainSlug } from './config/chains'
import { batchDistributorAbi, erc20Abi } from './contracts/abis'
import {
  addressBookToCsv,
  createAddressBookIfMissing,
  deleteAddressBook,
  listAddressBooks,
  requestAddressBookPersistence,
  updateAddressBook,
} from './lib/addressBook'
import type { AddressBookRecord } from './lib/addressBook'
import { buildBatches } from './lib/batches'
import type { PreparedBatch } from './lib/batches'
import { parseRecipientsCsv } from './lib/csv'
import { formatUsdc, shortAddress, sumBigints } from './lib/format'
import {
  deleteSendHistoryRecord as deleteStoredSendHistoryRecord,
  listSendHistory,
  sortSendHistory,
  upsertSendHistoryRecord as saveSendHistoryRecord,
} from './lib/sendHistory'
import type { SendHistoryRecord } from './lib/sendHistory'
import { loadJson, saveJson } from './lib/storage'

type BatchStatus = 'idle' | 'pending' | 'sent' | 'failed'
type ActiveTab = 'send' | 'address-book' | 'history'

type StoredBatchState = {
  error?: string
  status: BatchStatus
  txHash?: Hex
  updatedAt: string
}

type ChainRuntime = {
  allowanceRaw?: bigint
  balanceRaw?: bigint
  checkedAt?: string
  error?: string
  loading?: boolean
}

type AddressOverrides = Partial<Record<ChainSlug, string>>
type BatchSizes = Record<ChainSlug, number>
type SupportedChainId = (typeof wagmiConfig.chains)[number]['id']
type ChainListFilter = 'mainnets' | 'testnets' | 'all'

const progressStorageKey = 'usdc-sender.progress.v1'
const addressStorageKey = 'usdc-sender.batch-addresses.v1'
const recipientsStorageKey = 'usdc-sender.recipients.v1'
const batchDistributorRuntimeBytecodeHash =
  '0x41f19b00b24bd5a51a24f9dc482eacfd54822f6a6c0f923864c5651e376e6be8'
const usdcLogoUrl =
  'https://www.tbstat.com/cdn-cgi/image/f=avif,q=80/wp/uploads/2023/10/usdc.png'

const recipientCsvPlaceholder = `address,amount
0x000000000000000000000000000000000000dEaD,0.01`
const chainListFilters: Array<{
  label: string
  value: ChainListFilter
}> = [
  { label: 'Mainnets', value: 'mainnets' },
  { label: 'Testnets', value: 'testnets' },
  { label: 'All', value: 'all' },
]

function App() {
  const account = useAccount()
  const { switchNetwork } = useAppKitNetwork()
  const csvFileInputRef = useRef<HTMLInputElement>(null)
  const sendHistoryRef = useRef<SendHistoryRecord[]>([])

  const [addressBooks, setAddressBooks] = useState<AddressBookRecord[]>([])
  const [addressBookLoading, setAddressBookLoading] = useState(true)
  const [addressBookName, setAddressBookName] = useState('')
  const [addressBookPersisted, setAddressBookPersisted] = useState(false)
  const [sendAddressBookName, setSendAddressBookName] = useState('')
  const [activeTab, setActiveTab] = useState<ActiveTab>('send')
  const [selectedAddressBookId, setSelectedAddressBookId] = useState('')
  const [sendHistory, setSendHistory] = useState<SendHistoryRecord[]>([])
  const [selectedChainSlug, setSelectedChainSlug] =
    useState<ChainSlug>(defaultChainSlug)
  const [csvText, setCsvText] = useState(() =>
    loadJson(recipientsStorageKey, ''),
  )
  const [operationMessage, setOperationMessage] = useState('')
  const [addressOverrides] = useState<AddressOverrides>(
    () => loadJson(addressStorageKey, createEmptyAddressMap()),
  )
  const [batchStates, setBatchStates] = useState<Record<string, StoredBatchState>>(
    () => loadJson(progressStorageKey, {}),
  )
  const [runtimeBySlug, setRuntimeBySlug] = useState<Record<ChainSlug, ChainRuntime>>(
    createEmptyRuntimeMap,
  )
  const [batchSizes, setBatchSizes] = useState<BatchSizes>(
    createDefaultBatchSizeMap,
  )
  const [networkSwitching, setNetworkSwitching] = useState(false)

  const selectedChain = getChainConfig(selectedChainSlug)
  const parsed = useMemo(
    () => parseRecipientsCsv(csvText, selectedChainSlug),
    [csvText, selectedChainSlug],
  )
  const activeRows = useMemo(
    () => parsed.rows,
    [parsed.rows],
  )
  const activeIssues = parsed.issues
  const allIssues = activeIssues
  const blockingIssues = allIssues.filter((issue) => issue.level === 'error')
  const batches = useMemo(
    () => buildBatches(activeRows, batchSizes),
    [activeRows, batchSizes],
  )
  const currentNetworkAddressBooks = useMemo(
    () => addressBooks.filter((book) => book.chainSlug === selectedChainSlug),
    [addressBooks, selectedChainSlug],
  )
  const selectedAddressBook = useMemo(
    () =>
      currentNetworkAddressBooks.find((book) => book.id === selectedAddressBookId) ??
      null,
    [currentNetworkAddressBooks, selectedAddressBookId],
  )
  const currentNetworkSendHistory = useMemo(
    () => sendHistory.filter((record) => record.chainSlug === selectedChainSlug),
    [sendHistory, selectedChainSlug],
  )
  const recipientErrors = activeIssues.filter((issue) => issue.level === 'error')
  const canSaveNewAddressBook =
    activeRows.length > 0 &&
    recipientErrors.length === 0 &&
    !addressBookLoading
  const canUpdateAddressBookInfo =
    Boolean(selectedAddressBook) &&
    addressBookName.trim().length > 0 &&
    !addressBookLoading
  const canReplaceAddressBookRows =
    canUpdateAddressBookInfo &&
    activeRows.length > 0 &&
    recipientErrors.length === 0

  const selectedSummary = useMemo(() => {
    const rows = activeRows
    const chainBatches = batches.filter(
      (batch) => batch.chainSlug === selectedChain.slug,
    )
    const totalRaw = sumBigints(rows.map((row) => row.amountRaw))
    const sentTotalRaw = sumBigints(
      chainBatches
        .filter((batch) => batchStates[batch.id]?.status === 'sent')
        .map((batch) => batch.totalRaw),
    )
    const failedCount = chainBatches.filter(
      (batch) => batchStates[batch.id]?.status === 'failed',
    ).length
    const pendingCount = chainBatches.filter(
      (batch) => batchStates[batch.id]?.status === 'pending',
    ).length
    const remainingRaw = totalRaw > sentTotalRaw ? totalRaw - sentTotalRaw : 0n
    const runtime = runtimeBySlug[selectedChain.slug]
    const contractAddress = getBatchAddress(selectedChain.slug, addressOverrides)
    const allowanceOk =
      remainingRaw === 0n ||
      (runtime.allowanceRaw !== undefined && runtime.allowanceRaw >= remainingRaw)

    return {
      allowanceOk,
      batches: chainBatches,
      chain: selectedChain,
      contractAddress,
      failedCount,
      pendingCount,
      remainingRaw,
      rows,
      runtime,
      sentTotalRaw,
      totalRaw,
    }
  }, [
    activeRows,
    addressOverrides,
    batchStates,
    batches,
    runtimeBySlug,
    selectedChain,
  ])

  useEffect(() => {
    saveJson(progressStorageKey, batchStates)
  }, [batchStates])

  useEffect(() => {
    saveJson(addressStorageKey, addressOverrides)
  }, [addressOverrides])

  useEffect(() => {
    saveJson(recipientsStorageKey, csvText)
  }, [csvText])

  const changeSelectedNetwork = useCallback((slug: ChainSlug) => {
    setSelectedChainSlug(slug)
    setSelectedAddressBookId('')
    setAddressBookName('')
    setSendAddressBookName('')
  }, [])

  useEffect(() => {
    if (!account.isConnected || !account.chainId || networkSwitching) {
      return
    }

    const connectedChain = getChainConfigById(account.chainId)

    if (connectedChain && connectedChain.slug !== selectedChainSlug) {
      changeSelectedNetwork(connectedChain.slug)
    }
  }, [
    account.chainId,
    account.isConnected,
    changeSelectedNetwork,
    networkSwitching,
    selectedChainSlug,
  ])

  useEffect(() => {
    let canceled = false

    async function loadSendHistoryState() {
      try {
        const records = await listSendHistory()

        if (!canceled) {
          sendHistoryRef.current = records
          setSendHistory(records)
        }
      } catch (error) {
        if (!canceled) {
          sendHistoryRef.current = []
          setSendHistory([])
          setOperationMessage(`Failed to load send history: ${getErrorMessage(error)}`)
        }
      }
    }

    void loadSendHistoryState()

    return () => {
      canceled = true
    }
  }, [])

  useEffect(() => {
    let canceled = false

    async function loadAddressBookState() {
      try {
        const [books, persisted] = await Promise.all([
          listAddressBooks(),
          requestAddressBookPersistence(),
        ])

        if (canceled) {
          return
        }

        setAddressBooks(books)
        setAddressBookPersisted(persisted)
      } catch (error) {
        if (!canceled) {
          setOperationMessage(`Failed to load address books: ${getErrorMessage(error)}`)
        }
      } finally {
        if (!canceled) {
          setAddressBookLoading(false)
        }
      }
    }

    void loadAddressBookState()

    return () => {
      canceled = true
    }
  }, [])

  useEffect(() => {
    if (!selectedAddressBook) {
      return
    }

    setAddressBookName(selectedAddressBook.name)
  }, [selectedAddressBook])

  const hasRows = activeRows.length > 0
  const canExecute =
    account.isConnected &&
    hasRows &&
    Boolean(selectedChain.usdcAddress) &&
    blockingIssues.length === 0 &&
    !networkSwitching

  const refreshGroup = useCallback(async (slug: ChainSlug) => {
    const chain = getChainConfig(slug)

    if (!account.address) {
      setOperationMessage('Connect wallet first')
      return
    }

    const usdcAddress = chain.usdcAddress

    if (!usdcAddress) {
      const message = `${chain.name} USDC address is not configured`

      setRuntimeBySlug((current) => ({
        ...current,
        [slug]: { ...current[slug], error: message, loading: false },
      }))
      setOperationMessage(message)
      return
    }

    setRuntimeBySlug((current) => ({
      ...current,
      [slug]: { ...current[slug], loading: true, error: undefined },
    }))

    try {
      const spender = getBatchAddress(slug, addressOverrides)
      const batchContractError = spender
        ? await getBatchContractError(toSupportedChainId(chain.id), spender)
        : 'Batch contract address is not configured'
      const balanceRaw = (await readContract(wagmiConfig, {
        abi: erc20Abi,
        address: usdcAddress,
        args: [account.address],
        chainId: toSupportedChainId(chain.id),
        functionName: 'balanceOf',
      })) as bigint
      const allowanceRaw = spender
        ? ((await readContract(wagmiConfig, {
            abi: erc20Abi,
            address: usdcAddress,
            args: [account.address, spender],
            chainId: toSupportedChainId(chain.id),
            functionName: 'allowance',
          })) as bigint)
        : undefined

      setRuntimeBySlug((current) => ({
        ...current,
        [slug]: {
          allowanceRaw,
          balanceRaw,
          checkedAt: new Date().toLocaleTimeString(),
          error: batchContractError,
          loading: false,
        },
      }))
      setOperationMessage(`${chain.name} refreshed`)
    } catch (error) {
      setRuntimeBySlug((current) => ({
        ...current,
        [slug]: {
          ...current[slug],
          error: getErrorMessage(error),
          loading: false,
        },
      }))
      setOperationMessage(getErrorMessage(error))
    }
  }, [account.address, addressOverrides])

  useEffect(() => {
    if (!account.isConnected || !account.address) {
      return
    }

    void refreshGroup(selectedChainSlug)
  }, [account.address, account.isConnected, refreshGroup, selectedChainSlug])

  async function ensureSufficientAllowance(slug: ChainSlug, requiredRaw: bigint) {
    const chain = getChainConfig(slug)
    const spender = getBatchAddress(slug, addressOverrides)
    const usdcAddress = chain.usdcAddress

    if (slug !== selectedChainSlug) {
      setOperationMessage('This batch send can only use the currently selected chain')
      return false
    }

    if (!account.address) {
      setOperationMessage('Connect wallet first')
      return false
    }

    if (!usdcAddress) {
      setOperationMessage(`${chain.name} USDC address is not configured`)
      return false
    }

    if (!spender) {
      setOperationMessage(`${chain.name} batch contract address is missing`)
      return false
    }

    const batchContractError = await getBatchContractError(
      toSupportedChainId(chain.id),
      spender,
    )

    if (batchContractError) {
      setOperationMessage(`${chain.name} ${batchContractError}`)
      return false
    }

    if (requiredRaw === 0n) {
      setOperationMessage(`${chain.name} has no amount left to send`)
      return false
    }

    try {
      await ensureChain(slug)
      const allowanceRaw = (await readContract(wagmiConfig, {
        abi: erc20Abi,
        address: usdcAddress,
        args: [account.address, spender],
        chainId: toSupportedChainId(chain.id),
        functionName: 'allowance',
      })) as bigint

      if (allowanceRaw >= requiredRaw) {
        return true
      }

      setOperationMessage(`${chain.name} allowance is insufficient; waiting for wallet approval`)
      const hash = await writeContract(wagmiConfig, {
        abi: erc20Abi,
        address: usdcAddress,
        args: [spender, requiredRaw],
        chainId: toSupportedChainId(chain.id),
        functionName: 'approve',
      })

      setOperationMessage(`${chain.name} approval confirming ${shortAddress(hash)}`)
      await waitForTransactionReceipt(wagmiConfig, {
        chainId: toSupportedChainId(chain.id),
        hash,
      })

      setRuntimeBySlug((current) => ({
        ...current,
        [slug]: {
          ...current[slug],
          allowanceRaw: requiredRaw,
          checkedAt: new Date().toLocaleTimeString(),
        },
      }))
      setOperationMessage(`${chain.name} approval complete, continuing`)
      return true
    } catch (error) {
      setOperationMessage(getErrorMessage(error))
      return false
    }
  }

  async function sendNextBatch(slug: ChainSlug, onlyFailed: boolean) {
    if (slug !== selectedChainSlug) {
      setOperationMessage('This batch send can only use the currently selected chain')
      return
    }

    const target = batches.find((batch) => {
      if (batch.chainSlug !== slug) {
        return false
      }

      const status = batchStates[batch.id]?.status ?? 'idle'
      return onlyFailed ? status === 'failed' : status !== 'sent' && status !== 'pending'
    })

    if (!target) {
      setOperationMessage('No sendable batches')
      return
    }

    await sendPreparedBatch(target)
  }

  async function sendPreparedBatch(batch: PreparedBatch) {
    const savedForSend = await saveAddressBookBeforeSend()

    if (!savedForSend) {
      return
    }

    const allowanceReady = await ensureSufficientAllowance(
      batch.chainSlug,
      batch.totalRaw,
    )

    if (!allowanceReady) {
      return
    }

    await sendBatch(batch)
  }

  async function sendAllRemaining(slug: ChainSlug) {
    if (slug !== selectedChainSlug) {
      setOperationMessage('This batch send can only use the currently selected chain')
      return
    }

    const chainBatches = batches.filter((batch) => batch.chainSlug === slug)
    const sendableBatches = chainBatches.filter((batch) => {
      const status = batchStates[batch.id]?.status ?? 'idle'
      return status !== 'sent' && status !== 'pending'
    })

    if (sendableBatches.length === 0) {
      setOperationMessage('No sendable batches')
      return
    }

    const savedForSend = await saveAddressBookBeforeSend()

    if (!savedForSend) {
      return
    }

    const requiredRaw = sumBigints(sendableBatches.map((batch) => batch.totalRaw))
    const allowanceReady = await ensureSufficientAllowance(slug, requiredRaw)

    if (!allowanceReady) {
      return
    }

    for (const batch of sendableBatches) {
      await sendBatch(batch)
    }
  }

  async function sendBatch(batch: PreparedBatch) {
    const chain = getChainConfig(batch.chainSlug)
    const spender = getBatchAddress(batch.chainSlug, addressOverrides)
    const usdcAddress = chain.usdcAddress

    if (batch.chainSlug !== selectedChainSlug) {
      setOperationMessage('This batch send can only use the currently selected chain')
      return
    }

    if (!account.address) {
      setOperationMessage('Connect wallet first')
      return
    }

    if (!usdcAddress) {
      setOperationMessage(`${chain.name} USDC address is not configured`)
      return
    }

    if (!spender) {
      setOperationMessage(`${chain.name} batch contract address is missing`)
      return
    }

    const batchContractError = await getBatchContractError(
      toSupportedChainId(chain.id),
      spender,
    )

    if (batchContractError) {
      setOperationMessage(`${chain.name} ${batchContractError}`)
      return
    }

    if (blockingIssues.length > 0) {
      setOperationMessage('CSV still has errors')
      return
    }

    let txHash: Hex | undefined

    try {
      setOperationMessage(`${chain.name} batch ${batch.index} preparing to send`)
      await ensureChain(batch.chainSlug)

      const allowanceRaw = (await readContract(wagmiConfig, {
        abi: erc20Abi,
        address: usdcAddress,
        args: [account.address, spender],
        chainId: toSupportedChainId(chain.id),
        functionName: 'allowance',
      })) as bigint

      if (allowanceRaw < batch.totalRaw) {
        upsertSendHistoryFromBatch(batch, {
          error: 'Insufficient allowance',
          status: 'failed',
        })
        setOperationMessage(`${chain.name} allowance is insufficient`)
        return
      }

      txHash = await writeContract(wagmiConfig, {
        abi: batchDistributorAbi,
        address: spender,
        args: [usdcAddress, batch.recipients, batch.amounts],
        chainId: toSupportedChainId(chain.id),
        functionName: 'batchTransferFrom',
      })

      setBatchState(batch.id, {
        status: 'pending',
        txHash,
      })
      upsertSendHistoryFromBatch(batch, {
        status: 'pending',
        txHash,
      })
      setOperationMessage(`${chain.name} batch ${batch.index} confirming`)

      const receipt = await waitForTransactionReceipt(wagmiConfig, {
        chainId: toSupportedChainId(chain.id),
        hash: txHash,
      })

      if (receipt.status === 'reverted') {
        throw new Error('Transaction reverted')
      }

      setBatchState(batch.id, {
        status: 'sent',
        txHash,
      })
      upsertSendHistoryFromBatch(batch, {
        status: 'sent',
        txHash,
      })
      setOperationMessage(`${chain.name} batch ${batch.index} sent`)
      await refreshGroup(batch.chainSlug)
    } catch (error) {
      const errorMessage = getErrorMessage(error)
      setBatchState(batch.id, {
        error: errorMessage,
        status: 'failed',
      })
      upsertSendHistoryFromBatch(batch, {
        error: errorMessage,
        status: 'failed',
        txHash,
      })
      setOperationMessage(errorMessage)
    }
  }

  async function ensureChain(slug: ChainSlug) {
    const chain = getChainConfig(slug)

    if (account.chainId === chain.id) {
      return
    }

    setOperationMessage(`${chain.name} waiting for wallet network switch`)
    await switchNetwork(chain.wagmiChain)
  }

  async function handleNetworkChange(slug: ChainSlug) {
    const chain = getChainConfig(slug)
    const contractAddress = getBatchAddress(slug, addressOverrides)

    if (!contractAddress) {
      setOperationMessage(`${chain.name} contract address is not configured`)
      return
    }

    if (slug === selectedChainSlug) {
      return
    }

    setNetworkSwitching(true)

    try {
      if (account.isConnected && account.chainId !== chain.id) {
        setOperationMessage(`${chain.name} waiting for wallet network switch`)
        await switchNetwork(chain.wagmiChain)
      }

      changeSelectedNetwork(slug)
      setOperationMessage(`Network switched: ${chain.shortName}`)
    } catch (error) {
      setOperationMessage(`Network switch failed: ${getErrorMessage(error)}`)
    } finally {
      setNetworkSwitching(false)
    }
  }

  function setBatchState(
    stateId: string,
    nextState: Pick<StoredBatchState, 'status'> &
      Partial<Omit<StoredBatchState, 'status' | 'updatedAt'>>,
  ) {
    setBatchStates((current) => ({
      ...current,
      [stateId]: {
        ...current[stateId],
        ...nextState,
        updatedAt: new Date().toISOString(),
      },
    }))
  }

  function clearProgress() {
    setBatchStates({})
    setOperationMessage('Send status reset')
  }

  function upsertSendHistoryFromBatch(
    batch: PreparedBatch,
    nextState: {
      status: BatchStatus
    } &
      Partial<
        Pick<SendHistoryRecord, 'error' | 'sender' | 'txHash'>
      >,
  ) {
    const now = new Date().toISOString()
    const id = createSendHistoryId(batch)
    const current = sendHistoryRef.current
    const existing = current.find((record) => record.id === id)
    const next: SendHistoryRecord = {
      batchId: batch.batchId,
      batchIndex: batch.index,
      chainSlug: batch.chainSlug,
      createdAt: existing?.createdAt ?? now,
      error: nextState.error,
      id,
      recipientCount: batch.rows.length,
      sender: nextState.sender ?? account.address,
      status: nextState.status,
      totalRaw: batch.totalRaw.toString(),
      txHash: nextState.txHash,
      updatedAt: now,
    }
    const nextHistory = sortSendHistory([
      next,
      ...current.filter((record) => record.id !== id),
    ])

    sendHistoryRef.current = nextHistory
    setSendHistory(nextHistory)
    void saveSendHistoryRecord(next).catch((error) => {
      setOperationMessage(`Failed to save send history: ${getErrorMessage(error)}`)
    })
  }

  function exportSendHistoryCsv(records: SendHistoryRecord[]) {
    const lines = [
      [
        'status',
        'chain',
        'batchId',
        'batchIndex',
        'recipientCount',
        'totalUsdc',
        'sender',
        'txHash',
        'error',
        'updatedAt',
      ].join(','),
      ...records.map((record) =>
        [
          record.status,
          getChainConfig(record.chainSlug).name,
          record.batchId,
          record.batchIndex.toString(),
          record.recipientCount.toString(),
          formatUsdc(BigInt(record.totalRaw)),
          record.sender ?? '',
          record.txHash ?? '',
          record.error ?? '',
          record.updatedAt,
        ]
          .map(csvCell)
          .join(','),
      ),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `usdc-sender-history-${new Date().toISOString()}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  function deleteSendHistoryRecord(record: SendHistoryRecord) {
    const shouldDelete = window.confirm('Delete this send history record?')

    if (!shouldDelete) {
      return
    }

    const nextHistory = sendHistoryRef.current.filter(
      (historyRecord) => historyRecord.id !== record.id,
    )

    sendHistoryRef.current = nextHistory
    setSendHistory(nextHistory)
    void deleteStoredSendHistoryRecord(record.id).catch((error) => {
      setOperationMessage(`Failed to delete send history: ${getErrorMessage(error)}`)
    })
    setOperationMessage('Send history deleted')
  }

  async function refreshAddressBooks(selectId?: string) {
    const books = await listAddressBooks()

    setAddressBooks(books)

    if (selectId !== undefined) {
      setSelectedAddressBookId(selectId)
      return
    }

    if (
      selectedAddressBookId &&
      !books.some(
        (book) =>
          book.id === selectedAddressBookId && book.chainSlug === selectedChainSlug,
      )
    ) {
      setSelectedAddressBookId('')
    }
  }

  async function saveCurrentAddressBook() {
    try {
      const name = resolveAddressBookName(
        sendAddressBookName,
        currentNetworkAddressBooks,
      )
      const result = await saveAddressBookByName({
        chainSlug: selectedChainSlug,
        name,
        recipients: getCurrentAddressBookRecipients(),
      })

      await refreshAddressBooks(result.book.id)
      setSendAddressBookName('')
      let message = `Address book saved: ${result.book.name}`

      if (result.updated) {
        message = `Address book updated: ${result.book.name}`
      } else if (result.reused) {
        message = `An address book with the same data already exists: ${result.book.name}`
      }

      setOperationMessage(message)
    } catch (error) {
      setOperationMessage(getErrorMessage(error))
    }
  }

  async function updateSelectedAddressBookInfo() {
    if (!selectedAddressBook) {
      setOperationMessage('Select an address book to update')
      return
    }

    try {
      const book = await updateAddressBook(selectedAddressBook.id, {
        chainSlug: selectedAddressBook.chainSlug,
        name: addressBookName,
        recipients: selectedAddressBook.recipients,
      })

      await refreshAddressBooks(book.id)
      setOperationMessage(`Address book info updated: ${book.name}`)
    } catch (error) {
      setOperationMessage(getErrorMessage(error))
    }
  }

  async function replaceSelectedAddressBookRows(bookId: string) {
    const bookToReplace = currentNetworkAddressBooks.find(
      (book) => book.id === bookId,
    )

    if (!bookToReplace) {
      setOperationMessage('Select an address book to replace rows')
      return
    }

    try {
      const book = await updateAddressBook(bookToReplace.id, {
        chainSlug: bookToReplace.chainSlug,
        name: addressBookName,
        recipients: getCurrentAddressBookRecipients(),
      })

      await refreshAddressBooks(book.id)
      setOperationMessage(`Address book rows updated: ${book.name}`)
    } catch (error) {
      setOperationMessage(getErrorMessage(error))
    }
  }

  async function saveAddressBookBeforeSend() {
    if (activeRows.length === 0 || recipientErrors.length > 0) {
      setOperationMessage('Address book auto-save before sending failed: recipient list is invalid')
      return false
    }

    try {
      const name = resolveAddressBookName(
        sendAddressBookName,
        currentNetworkAddressBooks,
      )
      const result = await saveAddressBookByName({
        chainSlug: selectedChainSlug,
        name,
        recipients: getCurrentAddressBookRecipients(),
      })

      await refreshAddressBooks(result.book.id)
      return true
    } catch (error) {
      setOperationMessage(`Address book auto-save before sending failed: ${getErrorMessage(error)}`)
      return false
    }
  }

  async function saveAddressBookByName(draft: {
    chainSlug: ChainSlug
    name: string
    recipients: ReturnType<typeof getCurrentAddressBookRecipients>
  }) {
    const existing = currentNetworkAddressBooks.find(
      (book) => book.name.trim().toLowerCase() === draft.name.trim().toLowerCase(),
    )

    if (existing) {
      return {
        book: await updateAddressBook(existing.id, draft),
        reused: false,
        updated: true,
      }
    }

    const result = await createAddressBookIfMissing(draft)

    return {
      book: result.book,
      reused: !result.created,
      updated: false,
    }
  }

  function getCurrentAddressBookRecipients() {
    return activeRows.map((row) => ({
      address: row.address,
      amount: row.amount,
    }))
  }

  async function removeSelectedAddressBook() {
    if (!selectedAddressBook) {
      setOperationMessage('Select an address book to delete')
      return
    }

    const shouldDelete = window.confirm(`Delete address book "${selectedAddressBook.name}"?`)

    if (!shouldDelete) {
      return
    }

    try {
      await deleteAddressBook(selectedAddressBook.id)
      await refreshAddressBooks('')
      setAddressBookName('')
      setOperationMessage(`Address book deleted: ${selectedAddressBook.name}`)
    } catch (error) {
      setOperationMessage(getErrorMessage(error))
    }
  }

  function selectAddressBook(book: AddressBookRecord) {
    setSelectedAddressBookId(book.id)
    setAddressBookName(book.name)
  }

  function loadAddressBookForSending(book: AddressBookRecord) {
    setSelectedAddressBookId(book.id)
    setSelectedChainSlug(book.chainSlug)
    setActiveTab('send')
    setCsvText(addressBookToCsv(book))
    setBatchStates({})
    setAddressBookName(book.name)
    setSendAddressBookName(book.name)
    setOperationMessage(`Address book selected: ${book.name}`)
  }

  function handleCsvFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file) {
      return
    }

    void importCsvFile(file)
  }

  async function importCsvFile(file: File) {
    try {
      const text = await file.text()
      const imported = parseRecipientsCsv(text, selectedChainSlug)
      const errors = imported.issues.filter((issue) => issue.level === 'error')

      setCsvText(text)
      setBatchStates({})
      setOperationMessage(
        errors.length > 0
          ? `CSV imported with ${errors.length} format errors`
          : `CSV imported: ${imported.rows.length} rows`,
      )
    } catch (error) {
      setOperationMessage(getErrorMessage(error))
    }
  }

  function exportRecipientsCsv() {
    const lines = [
      'address,amount',
      ...activeRows.map((row) => [row.address, row.amount].map(csvCell).join(',')),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv' })
    const url = URL.createObjectURL(blob)
    const link = document.createElement('a')

    link.href = url
    link.download = `usdc-sender-recipients-${new Date().toISOString()}.csv`
    link.click()
    URL.revokeObjectURL(url)
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-lockup">
          <span className="brand-mark" aria-hidden="true">
            <CircleLogoIcon size="lg" />
          </span>
          <div>
            <p className="eyebrow">USDC batch sender</p>
            <h1>USDC Sender</h1>
          </div>
        </div>
        <div className="topbar-actions">
          <div className="topbar-controls">
            <ChainSelector
              addressOverrides={addressOverrides}
              connectedChainId={account.chainId}
              disabled={networkSwitching}
              runtimeBySlug={runtimeBySlug}
              selectedChainSlug={selectedChainSlug}
              onSelect={(slug) => void handleNetworkChange(slug)}
            />
          </div>
          <div className="wallet-area">
            <AppKitButton label="Connect Wallet" balance="hide" />
          </div>
        </div>
      </header>

      <section className="protocol-hero" aria-label="Transfer overview">
        <div className="hero-copy">
          <div className="hero-kicker">
            <CircleDollarSign size={18} />
            <span>ERC-20 USDC</span>
          </div>
          <div className="hero-total">
            <span>Total queued</span>
            <strong>{formatUsdc(selectedSummary.totalRaw)} USDC</strong>
          </div>
        </div>

        <div className="hero-visual" aria-hidden="true">
          <img src={heroImage} alt="" />
          <div className="flow-track">
            <span>Wallet</span>
            <i />
            <span>BatchDistributor</span>
            <i />
            <span>{activeRows.length} recipients</span>
          </div>
        </div>
      </section>

      <nav className="subnav" aria-label="Primary sections">
        <button
          type="button"
          className={activeTab === 'send' ? 'tab-button active' : 'tab-button'}
          onClick={() => setActiveTab('send')}
        >
          <Send size={15} />
          Send
        </button>
        <button
          type="button"
          className={
            activeTab === 'address-book' ? 'tab-button active' : 'tab-button'
          }
          onClick={() => setActiveTab('address-book')}
        >
          <BookOpen size={15} />
          Address Book
        </button>
        <button
          type="button"
          className={activeTab === 'history' ? 'tab-button active' : 'tab-button'}
          onClick={() => setActiveTab('history')}
        >
          <FileCheck2 size={15} />
          Send History
        </button>
      </nav>

      {activeTab === 'send' ? (
        <section className="workspace-section send-workspace">
          <div className="panel input-panel">
            <div className="panel-header">
              <div className="panel-heading">
                <span className="section-icon">
                  <WalletCards size={18} />
                </span>
                <div>
                  <h2>Recipients</h2>
                  <p>
                    {activeRows.length} {selectedChain.name} rows
                  </p>
                </div>
              </div>
            </div>
            <textarea
              aria-label="Recipients CSV"
              placeholder={recipientCsvPlaceholder}
              spellCheck={false}
              value={csvText}
              onChange={(event) => setCsvText(event.target.value)}
            />
            <IssueList issues={allIssues} />
            <div className="recipient-actions">
              <div className="send-control-panel">
                <label className="batch-size-row compact">
                  <span>Recipients per batch</span>
                  <input
                    min={1}
                    type="number"
                    value={batchSizes[selectedChain.slug] ?? selectedChain.defaultBatchSize}
                    onChange={(event) =>
                      setBatchSizes((current) => ({
                        ...current,
                        [selectedChain.slug]: Number(event.target.value),
                      }))
                    }
                  />
                </label>

                <div className="action-row send-action-row">
                  <button
                    type="button"
                    className="primary-button"
                    disabled={
                      !canExecute ||
                      !selectedSummary.chain.usdcAddress ||
                      !selectedSummary.contractAddress ||
                      selectedSummary.remainingRaw === 0n
                    }
                    onClick={() => void sendAllRemaining(selectedSummary.chain.slug)}
                  >
                    <Send size={17} />
                    Send All
                  </button>
                  <button
                    type="button"
                    className="secondary-button"
                    disabled={
                      !canExecute ||
                      !selectedSummary.chain.usdcAddress ||
                      !selectedSummary.contractAddress ||
                      selectedSummary.remainingRaw === 0n
                    }
                    onClick={() => void sendNextBatch(selectedSummary.chain.slug, false)}
                  >
                    Send Next
                  </button>
                </div>
              </div>

              <div className="toolbar recipient-tool-row">
                <input
                  ref={csvFileInputRef}
                  accept=".csv,text/csv"
                  className="file-input"
                  onChange={handleCsvFileChange}
                  type="file"
                />
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!account.isConnected || selectedSummary.runtime.loading}
                  onClick={() => void refreshGroup(selectedSummary.chain.slug)}
                >
                  {selectedSummary.runtime.loading ? (
                    <Loader2 className="spin" size={17} />
                  ) : (
                    <RefreshCcw size={17} />
                  )}
                  Refresh
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  onClick={() => csvFileInputRef.current?.click()}
                >
                  <Upload size={17} />
                  Import
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!hasRows}
                  onClick={exportRecipientsCsv}
                >
                  <Download size={17} />
                  Export
                </button>
                <button
                  type="button"
                  className="secondary-button"
                  disabled={!canSaveNewAddressBook}
                  onClick={() => void saveCurrentAddressBook()}
                >
                  <Save size={17} />
                  Save New
                </button>
                <button
                  type="button"
                  className="ghost-button"
                  disabled={Object.keys(batchStates).length === 0}
                  onClick={clearProgress}
                >
                  Reset Send Status
                </button>
              </div>
            </div>
          </div>

          <section className="chain-list">
            <article className="chain-panel" key={selectedSummary.chain.slug}>
              <div className="chain-title-row">
                <div className="panel-heading">
                  <span className="section-icon section-icon-blue">
                    <ChainLogoIcon chain={selectedSummary.chain} size="sm" />
                  </span>
                  <div>
                    <p className="eyebrow">{selectedSummary.chain.shortName}</p>
                    <h2>{selectedSummary.chain.name}</h2>
                  </div>
                </div>
                <StatusBadge
                  allowanceOk={selectedSummary.allowanceOk}
                  configured={Boolean(
                    selectedSummary.chain.usdcAddress &&
                      selectedSummary.contractAddress,
                  )}
                  failedCount={selectedSummary.failedCount}
                  rows={selectedSummary.rows.length}
                />
              </div>

              <div className="contract-strip">
                <span>
                  <CircleDollarSign size={15} />
                  USDC{' '}
                  {selectedSummary.chain.usdcAddress
                    ? shortAddress(selectedSummary.chain.usdcAddress)
                    : 'not configured'}
                </span>
                <span>
                  <ChainLogoIcon chain={selectedSummary.chain} size="sm" />
                  Contract{' '}
                  {selectedSummary.contractAddress
                    ? shortAddress(selectedSummary.contractAddress)
                    : 'not configured'}
                </span>
                <span>
                  <ShieldCheck size={15} />
                  {selectedSummary.pendingCount} pending
                </span>
              </div>

              <div className="metrics-grid">
                <Metric
                  icon={<WalletCards size={16} />}
                  label="Recipients"
                  tone="blue"
                  value={selectedSummary.rows.length.toString()}
                />
                <Metric
                  icon={<CircleDollarSign size={16} />}
                  label="Total"
                  tone="green"
                  value={`${formatUsdc(selectedSummary.totalRaw)} USDC`}
                />
                <Metric
                  icon={<Send size={16} />}
                  label="Remaining"
                  tone="amber"
                  value={`${formatUsdc(selectedSummary.remainingRaw)} USDC`}
                />
                <Metric
                  icon={<CircleLogoIcon />}
                  label="Batches"
                  value={selectedSummary.batches.length.toString()}
                />
                <Metric
                  icon={<WalletCards size={16} />}
                  label="Balance"
                  value={`${formatUsdc(selectedSummary.runtime.balanceRaw)} USDC`}
                />
                <Metric
                  icon={<ShieldCheck size={16} />}
                  label="Allowance"
                  value={`${formatUsdc(selectedSummary.runtime.allowanceRaw)} USDC`}
                />
              </div>

              {selectedSummary.chain.id === 5_042_002 ? (
                <p className="arc-note">
                  Arc Test gas token is USDC; transfer amounts use ERC-20 USDC 6 decimals.
                </p>
              ) : null}

              {selectedSummary.runtime.error ? (
                <p className="inline-error">
                  <AlertTriangle size={16} />
                  {selectedSummary.runtime.error}
                </p>
              ) : null}

              <BatchList
                batches={selectedSummary.batches}
                batchStates={batchStates}
                canRetry={
                  canExecute &&
                  Boolean(
                    selectedSummary.chain.usdcAddress &&
                      selectedSummary.contractAddress,
                  )
                }
                explorerBaseUrl={selectedSummary.chain.explorerTxBaseUrl}
                onRetryBatch={(batch) => void sendPreparedBatch(batch)}
              />
            </article>
          </section>
        </section>
      ) : null}

      {activeTab === 'address-book' ? (
        <AddressBookSection
          addressBookLoading={addressBookLoading}
          addressBookName={addressBookName}
          addressBookPersisted={addressBookPersisted}
          books={currentNetworkAddressBooks}
          canReplaceAddressBookRows={canReplaceAddressBookRows}
          canUpdateAddressBookInfo={canUpdateAddressBookInfo}
          selectedAddressBook={selectedAddressBook}
          onDeleteSelected={() => void removeSelectedAddressBook()}
          onNameChange={setAddressBookName}
          onSelectBook={selectAddressBook}
          onUseBook={loadAddressBookForSending}
          onUpdateInfo={() => void updateSelectedAddressBookInfo()}
          onReplaceRows={(bookId) => void replaceSelectedAddressBookRows(bookId)}
        />
      ) : null}

      {activeTab === 'history' ? (
        <SendHistorySection
          records={currentNetworkSendHistory}
          onDeleteRecord={deleteSendHistoryRecord}
          onExportRecord={(record) => exportSendHistoryCsv([record])}
        />
      ) : null}

      <footer className="status-bar">
        <span>{operationMessage || 'Ready'}</span>
        <span>{`${selectedSummary.chain.shortName} / ${blockingIssues.length} errors`}</span>
      </footer>
    </main>
  )
}

function ChainSelector({
  addressOverrides,
  connectedChainId,
  disabled,
  runtimeBySlug,
  selectedChainSlug,
  onSelect,
}: {
  addressOverrides: AddressOverrides
  connectedChainId?: number
  disabled: boolean
  runtimeBySlug: Record<ChainSlug, ChainRuntime>
  selectedChainSlug: ChainSlug
  onSelect: (slug: ChainSlug) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [listFilter, setListFilter] = useState<ChainListFilter>('mainnets')
  const rootRef = useRef<HTMLDivElement>(null)
  const selectedChain = getChainConfig(selectedChainSlug)
  const selectedRuntime = runtimeBySlug[selectedChainSlug] ?? {}
  const selectedContractAddress = getBatchAddress(selectedChainSlug, addressOverrides)
  const selectedWalletReady = connectedChainId === selectedChain.id
  const configuredContracts = appChains
    .map((chain) => getBatchAddress(chain.slug, addressOverrides))
    .filter((address): address is Address => Boolean(address))
  const sharedContractAddress =
    configuredContracts.length === appChains.length &&
    configuredContracts.every(
      (address) => address.toLowerCase() === configuredContracts[0].toLowerCase(),
    )
      ? configuredContracts[0]
      : null
  const chainCounts = useMemo(
    () =>
      chainListFilters.reduce<Record<ChainListFilter, number>>(
        (counts, filter) => ({
          ...counts,
          [filter.value]: appChains.filter((chain) =>
            matchesChainListFilter(chain, filter.value),
          ).length,
        }),
        {
          all: 0,
          mainnets: 0,
          testnets: 0,
        },
      ),
    [],
  )
  const filteredChains = appChains.filter((chain) => {
    const normalizedQuery = query.trim().toLowerCase()

    if (normalizedQuery) {
      return chain.aliases.some((alias) => alias.includes(normalizedQuery))
    }

    return matchesChainListFilter(chain, listFilter)
  })

  useEffect(() => {
    if (!open) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) {
        setOpen(false)
        setQuery('')
      }
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        setOpen(false)
        setQuery('')
      }
    }

    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)

    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [open])

  return (
    <div className="chain-selector" ref={rootRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="listbox"
        className="chain-selector-trigger"
        disabled={disabled}
        onClick={() => {
          if (open) {
            setQuery('')
          }

          setOpen(!open)
        }}
      >
        <span className="chain-selector-trigger-main">
          <ChainLogoIcon chain={selectedChain} size="md" />
          <span className="chain-selector-copy">
            <strong>{selectedChain.name}</strong>
          </span>
        </span>
        <span className="chain-selector-right">
          <span className="chain-selector-chain-id">Chain {selectedChain.id}</span>
          <ChainSelectorBadge
            configured={Boolean(selectedContractAddress)}
            connected={selectedWalletReady}
            runtime={selectedRuntime}
            showText={false}
          />
          <ChevronDown
            className={open ? 'chain-selector-chevron open' : 'chain-selector-chevron'}
            size={17}
          />
        </span>
      </button>

      {open ? (
        <div className="chain-selector-menu" role="listbox">
          <div className="chain-selector-menu-header">
            <span>
              {appChains.length} deployed USDC networks / CreateX{' '}
              {shortAddress(createxFactoryAddress)}
            </span>
            <strong>
              {sharedContractAddress
                ? `Same contract ${shortAddress(sharedContractAddress)}`
              : 'Deterministic contract per chain'}
            </strong>
          </div>

          <label className="chain-selector-search">
              <Search size={15} />
            <input
              autoFocus
              placeholder="Search all chains or chain ID"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </label>

          <div className="chain-selector-filters" aria-label="Chain filters">
            {chainListFilters.map((filter) => (
              <button
                type="button"
                className={
                  listFilter === filter.value
                    ? 'chain-filter-button active'
                    : 'chain-filter-button'
                }
                key={filter.value}
                onClick={() => setListFilter(filter.value)}
              >
                <span>{filter.label}</span>
                <small>{chainCounts[filter.value]}</small>
              </button>
            ))}
          </div>

          <div className="chain-selector-list-label">
            <span>{query.trim() ? 'Search results' : getChainFilterLabel(listFilter)}</span>
            <strong>{filteredChains.length}</strong>
          </div>

          <div className="chain-selector-options">
            {filteredChains.map((chain) => {
              const contractAddress = getBatchAddress(chain.slug, addressOverrides)
              const runtime = runtimeBySlug[chain.slug] ?? {}
              const selected = chain.slug === selectedChainSlug
              const connected = connectedChainId === chain.id
              const selectable = Boolean(contractAddress)

              return (
                <button
                  type="button"
                  aria-selected={selected}
                  className={selected ? 'chain-option active' : 'chain-option'}
                  disabled={disabled || !selectable}
                  key={chain.slug}
                  onClick={() => {
                    setOpen(false)
                    setQuery('')

                    if (!selected && selectable) {
                      setListFilter(getPreferredChainListFilter(chain))
                      onSelect(chain.slug)
                    }
                  }}
                  role="option"
                >
                  <span className="chain-option-main">
                    <ChainLogoIcon chain={chain} size="md" />
                    <span className="chain-option-copy">
                      <span className="chain-option-title">
                        <strong>{chain.name}</strong>
                        {connected ? <small>Wallet</small> : null}
                      </span>
                    </span>
                  </span>

                  <span className="chain-option-status">
                    <span className="chain-option-chain-id">Chain {chain.id}</span>
                    <ChainSelectorBadge
                      configured={Boolean(contractAddress)}
                      connected={connected}
                      runtime={runtime}
                      showText={false}
                    />
                  </span>
                </button>
              )
            })}
            {filteredChains.length === 0 ? (
              <p className="chain-selector-empty">No matching chains</p>
            ) : null}
          </div>
        </div>
      ) : null}
    </div>
  )
}

function getChainFilterLabel(filter: ChainListFilter) {
  if (filter === 'mainnets') {
    return 'Mainnet USDC networks'
  }

  if (filter === 'testnets') {
    return 'Testnet USDC networks'
  }

  return 'All deployed USDC networks'
}

function getPreferredChainListFilter(chain: (typeof appChains)[number]) {
  return isTestnetChain(chain) ? 'testnets' : 'mainnets'
}

function matchesChainListFilter(
  chain: (typeof appChains)[number],
  filter: ChainListFilter,
) {
  if (filter === 'all') {
    return true
  }

  const testnet = isTestnetChain(chain)
  return filter === 'testnets' ? testnet : !testnet
}

function isTestnetChain(chain: (typeof appChains)[number]) {
  return (
    /\b(testnet|sepolia|fuji|amoy|blaze|hoodi)\b/i.test(chain.name) ||
    chain.id === 51
  )
}

function ChainSelectorBadge({
  configured,
  connected,
  runtime,
  showText = true,
}: {
  configured: boolean
  connected: boolean
  runtime: ChainRuntime
  showText?: boolean
}) {
  if (!configured) {
    return (
      <span className="chain-selector-badge muted">
        {showText ? 'Contract not set' : null}
      </span>
    )
  }

  if (runtime.loading) {
    return (
      <span className="chain-selector-badge muted">
        <Loader2 className="spin" size={13} />
        {showText ? 'Checking' : null}
      </span>
    )
  }

  if (runtime.error) {
    return (
      <span className="chain-selector-badge error">
        {showText ? 'Check failed' : null}
      </span>
    )
  }

  if (runtime.checkedAt) {
    return (
      <span className="chain-selector-badge ok">
        {showText ? 'Bytecode OK' : null}
      </span>
    )
  }

  if (connected) {
    return (
      <span className="chain-selector-badge ok">
        {showText ? 'Selected' : null}
      </span>
    )
  }

  return <span className="chain-selector-badge muted">{showText ? 'Ready' : null}</span>
}

function AddressBookSection({
  addressBookLoading,
  addressBookName,
  addressBookPersisted,
  books,
  canReplaceAddressBookRows,
  canUpdateAddressBookInfo,
  selectedAddressBook,
  onDeleteSelected,
  onNameChange,
  onSelectBook,
  onUseBook,
  onUpdateInfo,
  onReplaceRows,
}: {
  addressBookLoading: boolean
  addressBookName: string
  addressBookPersisted: boolean
  books: AddressBookRecord[]
  canReplaceAddressBookRows: boolean
  canUpdateAddressBookInfo: boolean
  selectedAddressBook: AddressBookRecord | null
  onDeleteSelected: () => void
  onNameChange: (value: string) => void
  onSelectBook: (book: AddressBookRecord) => void
  onUseBook: (book: AddressBookRecord) => void
  onUpdateInfo: () => void
  onReplaceRows: (bookId: string) => void
}) {
  return (
    <section className="panel address-book-panel">
      <div className="panel-header address-book-header">
        <div>
          <h2>Address Book</h2>
          <p>
            {books.length} local books
            {addressBookPersisted ? ' / persistent storage' : ''}
          </p>
        </div>
        <BookOpen size={20} />
      </div>

      <div className="address-book-grid">
        <div className="address-book-library">
          {addressBookLoading ? (
            <p className="empty-batches">Loading address books</p>
          ) : books.length === 0 ? (
            <p className="empty-batches">No local address books</p>
          ) : (
            <div className="address-book-list">
              <div className="address-book-list-header" aria-hidden="true">
                <span>Book</span>
                <span>Addresses</span>
                <span>Total</span>
                <span>Updated</span>
              </div>
              {books.map((book) => (
                <button
                  type="button"
                  className={
                    selectedAddressBook?.id === book.id
                      ? 'address-book-row active'
                      : 'address-book-row'
                  }
                  key={book.id}
                  onClick={() => onSelectBook(book)}
                >
                  <span className="address-book-main">
                    <strong>{book.name}</strong>
                  </span>
                  <span className="address-book-count">
                    {getUniqueRecipientCount(book)}
                  </span>
                  <span className="address-book-total">
                    {formatUsdc(getBookTotalRaw(book))} USDC
                  </span>
                  <span className="address-book-updated">
                    {formatBookUpdatedAt(book.updatedAt)}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="address-book-editor">
          <div className="address-book-form-grid">
            <label className="address-field">
              <span>Name</span>
              <input
                value={addressBookName}
                placeholder="Operations payout"
                onChange={(event) => onNameChange(event.target.value)}
              />
            </label>
          </div>

          <div className="toolbar">
            <button
              type="button"
              className="secondary-button"
              disabled={!canUpdateAddressBookInfo}
              onClick={onUpdateInfo}
            >
              <Pencil size={17} />
              Update Info
            </button>
            <button
              type="button"
              className="secondary-button"
              disabled={!canReplaceAddressBookRows}
              onClick={() => {
                if (selectedAddressBook) {
                  onReplaceRows(selectedAddressBook.id)
                }
              }}
            >
              <Upload size={17} />
              Replace Rows
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={!selectedAddressBook}
              onClick={() => selectedAddressBook && onUseBook(selectedAddressBook)}
            >
              <Send size={17} />
              Use for Send
            </button>
            <button
              type="button"
              className="ghost-button"
              disabled={!selectedAddressBook}
              onClick={onDeleteSelected}
            >
              <Trash2 size={17} />
              Delete
            </button>
          </div>

          {selectedAddressBook ? (
            <div className="address-book-detail">
              <div className="address-book-recipient-list">
                <div className="address-book-recipient-header">
                  <span>#</span>
                  <span>Address</span>
                  <span>Amount</span>
                </div>
                {selectedAddressBook.recipients.map((recipient, index) => (
                  <div
                    className="address-book-recipient-row"
                    key={`${recipient.address}-${index}`}
                  >
                    <span>{index + 1}</span>
                    <span className="address-book-recipient-address">
                      {recipient.address}
                    </span>
                    <strong>{recipient.amount} USDC</strong>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="empty-batches">
              Select an address book to view all addresses and amounts.
            </p>
          )}
        </div>
      </div>
    </section>
  )
}

function SendHistorySection({
  records,
  onDeleteRecord,
  onExportRecord,
}: {
  records: SendHistoryRecord[]
  onDeleteRecord: (record: SendHistoryRecord) => void
  onExportRecord: (record: SendHistoryRecord) => void
}) {
  const [historyQuery, setHistoryQuery] = useState('')
  const normalizedHistoryQuery = historyQuery.trim().toLowerCase()
  const filteredRecords = useMemo(
    () =>
      normalizedHistoryQuery
        ? records.filter((record) =>
            [
              getChainConfig(record.chainSlug).name,
              getStatusLabel(record.status),
              record.txHash ?? '',
              record.batchId,
              record.error ?? '',
            ]
              .join(' ')
              .toLowerCase()
              .includes(normalizedHistoryQuery),
          )
        : records,
    [normalizedHistoryQuery, records],
  )

  return (
    <section className="panel history-panel">
      <div className="panel-header history-header">
        <div>
          <h2>Send History</h2>
          <p>
            {filteredRecords.length === records.length
              ? `${records.length} local records`
              : `${filteredRecords.length} of ${records.length} local records`}
          </p>
        </div>
        <label className="history-search">
          <Search size={15} />
          <input
            aria-label="Search send history"
            placeholder="Search batch / tx / status"
            type="search"
            value={historyQuery}
            onChange={(event) => setHistoryQuery(event.target.value)}
          />
        </label>
      </div>

      <div className="history-library">
          {records.length === 0 ? (
            <p className="empty-batches">No send history</p>
          ) : filteredRecords.length === 0 ? (
            <p className="empty-batches">No matching history</p>
          ) : (
            <div className="history-list">
              <div className="history-table-header">
                <span>Batch</span>
                <span>Time</span>
                <span>Addresses</span>
                <span>Total</span>
                <span>Status</span>
                <span>Tx</span>
                <span>Actions</span>
              </div>
              {filteredRecords.map((record) => {
                const chain = getChainConfig(record.chainSlug)

                return (
                  <div className="history-result-row" key={record.id}>
                    <span className="history-transfer">
                      <strong>Batch {record.batchIndex}</strong>
                      <small>{chain.shortName} / {shortAddress(record.batchId)}</small>
                    </span>
                    <span className="history-time">
                      {formatSendHistoryTime(record.updatedAt)}
                    </span>
                    <span className="history-count">{record.recipientCount}</span>
                    <span className="history-total">
                      {formatUsdc(BigInt(record.totalRaw))} USDC
                    </span>
                    <span
                      className={`status-badge ${getStatusBadgeClass(record.status)}`}
                      title={record.error ?? getStatusLabel(record.status)}
                    >
                      {getStatusLabel(record.status)}
                    </span>
                    <span className="history-tx-cell">
                      {record.txHash ? (
                      <a
                        className="history-link"
                        href={`${chain.explorerTxBaseUrl}/${record.txHash}`}
                        target="_blank"
                        rel="noreferrer"
                        title="Open transaction"
                      >
                        <ExternalLink size={15} />
                      </a>
                      ) : (
                        '-'
                      )}
                    </span>
                    <span className="history-actions">
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => onExportRecord(record)}
                        title="Export this record"
                      >
                        <Download size={15} />
                      </button>
                      <button
                        type="button"
                        className="icon-button"
                        onClick={() => onDeleteRecord(record)}
                        title="Delete this record"
                      >
                        <Trash2 size={15} />
                      </button>
                    </span>
                  </div>
                )
              })}
            </div>
          )}
      </div>
    </section>
  )
}

function IssueList({ issues }: { issues: ReturnType<typeof parseRecipientsCsv>['issues'] }) {
  if (issues.length === 0) {
    return (
      <div className="issue-list clean">
        <CheckCircle2 size={17} />
        CSV valid
      </div>
    )
  }

  const latestIssues = [
    issues.findLast((issue) => issue.level === 'error'),
    issues.findLast((issue) => issue.level === 'warning'),
  ].filter((issue): issue is (typeof issues)[number] => Boolean(issue))

  return (
    <div className="issue-list">
      {latestIssues.map((issue) => (
        <div className={`issue ${issue.level}`} key={`${issue.line}-${issue.message}`}>
          {issue.level === 'error' ? <XCircle size={16} /> : <AlertTriangle size={16} />}
          <span>{issue.line > 0 ? `Line ${issue.line}: ` : ''}{issue.message}</span>
        </div>
      ))}
    </div>
  )
}

function CircleLogoIcon({ size = 'md' }: { size?: 'lg' | 'md' | 'sm' }) {
  return (
    <span className={`circle-logo-icon circle-logo-${size}`} aria-hidden="true">
      <img src={usdcLogoUrl} alt="" draggable={false} />
    </span>
  )
}

function ChainLogoIcon({
  chain,
  size = 'md',
}: {
  chain: {
    iconBackgroundColor?: string
    iconUrl: string
    name: string
    shortName: string
  }
  size?: 'lg' | 'md' | 'sm'
}) {
  const [failedIconUrl, setFailedIconUrl] = useState('')
  const showImage = Boolean(chain.iconUrl) && failedIconUrl !== chain.iconUrl
  const style = chain.iconBackgroundColor
    ? ({
        '--chain-logo-bg': chain.iconBackgroundColor,
      } as CSSProperties)
    : undefined

  return (
    <span
      className={
        showImage
          ? `chain-logo-icon chain-logo-${size} has-image`
          : `chain-logo-icon chain-logo-${size} fallback`
      }
      style={style}
      aria-hidden="true"
    >
      {showImage ? (
        <img
          src={chain.iconUrl}
          alt=""
          draggable={false}
          onError={() => setFailedIconUrl(chain.iconUrl)}
        />
      ) : (
        <span>{getChainLogoInitials(chain.shortName || chain.name)}</span>
      )}
    </span>
  )
}

function getChainLogoInitials(label: string) {
  const parts = label
    .replace(/\b(testnet|sepolia|mainnet|network)\b/gi, '')
    .trim()
    .split(/\s+/)
    .filter(Boolean)

  if (parts.length === 1) {
    return parts[0].slice(0, 2).toUpperCase()
  }

  return (
    parts
      .slice(0, 2)
      .map((part) => part[0]?.toUpperCase())
      .join('') || label.slice(0, 2).toUpperCase()
  )
}

function Metric({
  icon,
  label,
  tone = 'neutral',
  value,
}: {
  icon?: ReactNode
  label: string
  tone?: 'amber' | 'blue' | 'green' | 'neutral'
  value: string
}) {
  return (
    <div className={`metric metric-${tone}`}>
      <span>
        {icon}
        {label}
      </span>
      <strong>{value}</strong>
    </div>
  )
}

function StatusBadge({
  allowanceOk,
  configured,
  failedCount,
  rows,
}: {
  allowanceOk: boolean
  configured: boolean
  failedCount: number
  rows: number
}) {
  if (rows === 0) {
    return <span className="status-badge muted-badge">No rows</span>
  }

  if (!configured) {
    return <span className="status-badge warn-badge">Needs contract</span>
  }

  if (failedCount > 0) {
    return <span className="status-badge error-badge">Failed batch</span>
  }

  if (!allowanceOk) {
    return <span className="status-badge warn-badge">Needs approval</span>
  }

  return <span className="status-badge ok-badge">Ready</span>
}

function BatchList({
  batches,
  batchStates,
  canRetry,
  explorerBaseUrl,
  onRetryBatch,
}: {
  batches: PreparedBatch[]
  batchStates: Record<string, StoredBatchState>
  canRetry: boolean
  explorerBaseUrl: string
  onRetryBatch: (batch: PreparedBatch) => void
}) {
  if (batches.length === 0) {
    return <p className="empty-batches">No recipients for this chain</p>
  }

  return (
    <div className="batch-list">
      {batches.map((batch) => {
        const state = batchStates[batch.id]
        const status = state?.status ?? 'idle'

        return (
          <div className="batch-row" key={batch.id}>
            <span className={`dot ${status}`} />
            <span>
              Batch {batch.index}: lines {batch.startLine}-{batch.endLine}
            </span>
            <strong>{formatUsdc(batch.totalRaw)} USDC</strong>
            <span className="muted">{status}</span>
            <span className="batch-row-actions">
              {state?.txHash ? (
                <a
                  href={`${explorerBaseUrl}/${state.txHash}`}
                  target="_blank"
                  rel="noreferrer"
                  title="Open transaction"
                >
                  <ExternalLink size={15} />
                </a>
              ) : null}
              {status === 'failed' ? (
                <button
                  aria-label={`Retry batch ${batch.index}`}
                  className="icon-button"
                  disabled={!canRetry}
                  onClick={() => onRetryBatch(batch)}
                  title="Retry this batch"
                  type="button"
                >
                  <RefreshCcw size={15} />
                </button>
              ) : null}
            </span>
          </div>
        )
      })}
    </div>
  )
}

function getBookTotalRaw(book: AddressBookRecord) {
  return sumBigints(
    book.recipients.map((recipient) => parseUnits(recipient.amount, 6)),
  )
}

function getUniqueRecipientCount(book: AddressBookRecord) {
  return new Set(
    book.recipients.map((recipient) => recipient.address.toLowerCase()),
  ).size
}

function formatBookUpdatedAt(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '-'
  }

  return date.toLocaleDateString('en-US', {
    day: '2-digit',
    month: 'short',
  })
}

function formatSendHistoryTime(value: string) {
  const date = new Date(value)

  if (Number.isNaN(date.getTime())) {
    return '-'
  }

  const datePart = [
    date.getFullYear(),
    padTimePart(date.getMonth() + 1),
    padTimePart(date.getDate()),
  ].join('-')
  const timePart = [
    padTimePart(date.getHours()),
    padTimePart(date.getMinutes()),
    padTimePart(date.getSeconds()),
  ].join(':')

  return `${datePart} ${timePart}`
}

function getStatusLabel(status: BatchStatus) {
  switch (status) {
    case 'failed':
      return 'Failed'
    case 'idle':
      return 'Draft'
    case 'pending':
      return 'Pending'
    case 'sent':
      return 'Sent'
  }
}

function getStatusBadgeClass(status: BatchStatus) {
  switch (status) {
    case 'failed':
      return 'error-badge'
    case 'idle':
      return 'muted-badge'
    case 'pending':
      return 'warn-badge'
    case 'sent':
      return 'ok-badge'
  }
}

function createSendHistoryId(
  batch: PreparedBatch,
) {
  return batch.batchId
}

async function getBatchContractError(
  chainId: SupportedChainId,
  address: Address,
) {
  try {
    const publicClient = getPublicClient(wagmiConfig, { chainId })

    if (!publicClient) {
      return 'Batch contract validation failed: RPC client is unavailable'
    }

    const code = await publicClient.getCode({ address })

    if (!code || code === '0x') {
      return 'Batch contract address has no deployed code'
    }

    if (keccak256(code) !== batchDistributorRuntimeBytecodeHash) {
      return 'Batch contract address is not the current BatchUSDCDistributor; update configuration and retry'
    }

    return undefined
  } catch (error) {
    return `Batch contract validation failed: ${getErrorMessage(error)}`
  }
}

function createEmptyAddressMap(): AddressOverrides {
  return {}
}

function createDefaultBatchSizeMap(): BatchSizes {
  return appChains.reduce((accumulator, chain) => {
    accumulator[chain.slug] = chain.defaultBatchSize
    return accumulator
  }, {} as BatchSizes)
}

function createEmptyRuntimeMap(): Record<ChainSlug, ChainRuntime> {
  return appChains.reduce((accumulator, chain) => {
    accumulator[chain.slug] = {}
    return accumulator
  }, {} as Record<ChainSlug, ChainRuntime>)
}

function resolveAddressBookName(
  inputName: string,
  books: AddressBookRecord[],
) {
  const trimmed = inputName.trim()

  if (trimmed) {
    return trimmed
  }

  const maxNumericName = books.reduce((max, book) => {
    if (!/^\d+$/.test(book.name)) {
      return max
    }

    return Math.max(max, Number(book.name))
  }, 0)

  return (maxNumericName + 1).toString()
}

function getBatchAddress(
  slug: ChainSlug,
  addressOverrides: AddressOverrides,
): Address | null {
  const configured =
    getChainConfig(slug).batchAddress || (addressOverrides[slug] ?? '').trim()

  if (!configured || !isConfiguredAddress(configured)) {
    return null
  }

  return getAddress(configured)
}

function padTimePart(value: number) {
  return value.toString().padStart(2, '0')
}

function toSupportedChainId(chainId: number) {
  return chainId as SupportedChainId
}

function csvCell(value: string) {
  if (!/[",\n]/.test(value)) {
    return value
  }

  return `"${value.replaceAll('"', '""')}"`
}

function getErrorMessage(error: unknown) {
  if (
    typeof error === 'object' &&
    error !== null &&
    'shortMessage' in error &&
    typeof (error as { shortMessage?: unknown }).shortMessage === 'string'
  ) {
    return (error as { shortMessage: string }).shortMessage
  }

  if (error instanceof Error) {
    return error.message
  }

  return 'Operation failed'
}

export default App
