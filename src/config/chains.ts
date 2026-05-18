import { createAppKit } from '@reown/appkit/react'
import { WagmiAdapter } from '@reown/appkit-adapter-wagmi'
import type { AppKitNetwork } from '@reown/appkit/networks'
import {
  arbitrum,
  arbitrumSepolia,
  arcTestnet,
  avalanche,
  avalancheFuji,
  base,
  baseSepolia,
  celo,
  celoSepolia,
  codex,
  codexTestnet,
  hyperEvm,
  hyperliquidEvmTestnet,
  injective,
  injectiveTestnet,
  ink,
  inkSepolia,
  linea,
  lineaSepolia,
  mainnet,
  monad,
  monadTestnet,
  morph,
  optimism,
  optimismSepolia,
  plumeMainnet,
  plumeSepolia,
  polygon,
  polygonAmoy,
  sei,
  seiTestnet,
  sonic,
  sonicBlazeTestnet,
  sonicTestnet,
  unichain,
  unichainSepolia,
  worldchain,
  worldchainSepolia,
  xdc,
  xdcTestnet,
  zkSync,
  zkSyncSepoliaTestnet,
} from 'viem/chains'
import { http } from 'wagmi'
import { defineChain, isAddress } from 'viem'
import type { Address } from 'viem'

import { reownProjectId } from './constants'

export type ChainSlug = string
type NumericAppKitNetwork = AppKitNetwork & { id: number }

export const createxFactoryAddress =
  '0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed' as Address

type ChainConfig = {
  aliases: string[]
  batchAddress: string
  defaultBatchSize: number
  explorerTxBaseUrl: string
  id: number
  iconBackgroundColor?: string
  iconUrl: string
  name: string
  shortName: string
  slug: ChainSlug
  usdcAddress: Address | null
  wagmiChain: NumericAppKitNetwork
}

const appUrl = 'https://usdcsender.xyz'
const reownAssetBaseUrl = 'https://api.web3modal.org/public/getAssetImage'
const batchDistributorAddressByChainId: Record<number, Address> = {
  1: '0xE5C25B629D9f96be224604e4c03305965357d7E4',
  5_042_002: '0xE5C25B629D9f96be224604e4c03305965357d7E4',
  8_453: '0xE5C25B629D9f96be224604e4c03305965357d7E4',
  84_532: '0xE5C25B629D9f96be224604e4c03305965357d7E4',
  42_161: '0xE5C25B629D9f96be224604e4c03305965357d7E4',
  57_073: '0xE5C25B629D9f96be224604e4c03305965357d7E4',
}

// EVM USDC addresses from Circle's official "USDC Contract Addresses" page.
// Entries without reliable AppKit-compatible chain metadata are intentionally
// excluded until the chain can be switched to and queried from the app.
const circleUsdcAddressByChainId: Record<number, Address> = {
  1: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
  10: '0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85',
  50: '0xfA2958CB79b0491CC627c1557F441eF849Ca8eb1',
  51: '0xb5AB69F7bBada22B28e79C8FFAECe55eF1c771D4',
  130: '0x078D782b760474a361dDA0AF3839290b0EF57AD6',
  143: '0x754704Bc059F8C67012fEd69BC8A327a5aafb603',
  146: '0x29219dd400f2Bf60E5a23d13Be72B486D4038894',
  137: '0x3c499c542cef5e3811e1192ce70d8cc03d5c3359',
  300: '0xAe045DE5638162fa134807Cb558E15A3F5A7F853',
  480: '0x79A02482A880bCE3F13e09Da970dC34db4CD24d1',
  998: '0x2B3370eE501B4a559b57D449569354196457D8Ab',
  999: '0xb88339CB7199b77E23DB6E890353E22632Ba630f',
  1_301: '0x31d0220469e10c4E71834a79b1f276d740d3768F',
  1_328: '0x4fCF1784B31630811181f670Aea7A7bEF803eaED',
  1_329: '0xe15fC38F6D8c56aF07bbCBe3BAf5708A2Bf42392',
  1_439: '0x0C382e685bbeeFE5d3d9C29e29E341fEE8E84C5d',
  1_776: '0xa00C59fF5a080D2b954d0c75e46E22a0c371235a',
  2_818: '0xCfb1186F4e93D60E60a8bDd997427D1F33bc372B',
  2_910: '0x7433b41C6c5e1d58D4Da99483609520255ab661B',
  3_343: '0x98d2919b9A214E6Fa5384AC81E6864bA686Ad74c',
  8_453: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  10_143: '0x534b2f3A21130d7a60830c2Df862319e593943A3',
  42_220: '0xcebA9300f2b948710d2653dD7B07f33A8B32118C',
  42_161: '0xaf88d065e77c8cC2239327C5EDb3A432268e5831',
  43_114: '0xB97EF9Ef8734C71904D8002F8b6Bc66Dd9c48a6E',
  43_113: '0x5425890298aed601595a70AB815c96711a31Bc65',
  57_054: '0xA4879Fed32Ecbef99399e5cbC247E533421C4eC6',
  57_073: '0x2D270e6886d130D724215A266106e6832161EAEd',
  59_144: '0x176211869cA2b568f2A7D4EE941E073a821EE1ff',
  59_141: '0xFEce4462D57bD51A6A552365A011b95f0E16d9B7',
  64_165: '0x0BA304580ee7c9a980CF72e55f5Ed2E9fd30Bc51',
  80_002: '0x41E94Eb019C0762f9Bfcf9Fb1E58725BfB0e7582',
  81_224: '0xd996633a415985DBd7D6D12f4A4343E31f5037cf',
  812_242: '0x6d7f141b6819C2c9CC2f818e6ad549E7Ca090F8f',
  84_532: '0x036CbD53842c5426634e7929541eC2318f3dCF7e',
  98_866: '0x222365EF19F7947e5484218551B56bb3965Aa7aF',
  98_867: '0xcB5f30e335672893c7eb944B374c196392C19D18',
  111_551_111: '0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238',
  11_142_220: '0x01C5C0122039549AD1493B8220cABEdD739BC44E',
  11_155_420: '0x5fd84259d66Cd46123540766Be93DFE6D43130D7',
  421_614: '0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d',
  763_373: '0xFabab97dCE620294D2B0b0e46C68964e326300Ac',
  4_801: '0x66145f38cBAC35Ca6F1Dfb4914dF98F1614aeA88',
  5_042_002: '0x3600000000000000000000000000000000000000',
  33_431: '0x2d9F7CAD728051AA35Ecdc472a14cf8cDF5CFD6B',
  324: '0x1d17CBcF0D6D143135aE902365D2E5e2A16538D4',
}

const circleChainRegistry: Array<[string, NumericAppKitNetwork]> = [
  ['arbitrum', arbitrum],
  ['arbitrumSepolia', arbitrumSepolia],
  ['arcTestnet', arcTestnet],
  ['avalanche', avalanche],
  ['avalancheFuji', avalancheFuji],
  ['base', base],
  ['baseSepolia', baseSepolia],
  ['celo', celo],
  ['celoSepolia', celoSepolia],
  ['codex', codex],
  ['codexTestnet', codexTestnet],
  ['edge', createEdgeMainnet()],
  ['edgeTestnet', createEdgeTestnet()],
  ['hyperEvm', hyperEvm],
  ['hyperliquidEvmTestnet', hyperliquidEvmTestnet],
  ['injective', injective],
  ['injectiveTestnet', injectiveTestnet],
  ['ink', ink],
  ['inkSepolia', inkSepolia],
  ['linea', linea],
  ['lineaSepolia', lineaSepolia],
  ['mainnet', mainnet],
  ['monad', monad],
  ['monadTestnet', monadTestnet],
  ['morph', morph],
  ['morphHoodi', createMorphHoodi()],
  ['optimism', optimism],
  ['optimismSepolia', optimismSepolia],
  ['plumeMainnet', plumeMainnet],
  ['plumeSepolia', plumeSepolia],
  ['polygon', polygon],
  ['polygonAmoy', polygonAmoy],
  ['sei', sei],
  ['seiTestnet', seiTestnet],
  ['sonic', sonic],
  ['sonicBlazeTestnet', sonicBlazeTestnet],
  ['sonicTestnet', sonicTestnet],
  ['unichain', unichain],
  ['unichainSepolia', unichainSepolia],
  ['worldchain', worldchain],
  ['worldchainSepolia', worldchainSepolia],
  ['xdc', xdc],
  ['xdcTestnet', xdcTestnet],
  ['zkSync', zkSync],
  ['zkSyncSepoliaTestnet', zkSyncSepoliaTestnet],
]

const reownNetworkImageIdByChainId: Record<number, string> = {
  1: 'ba0ba0cd-17c6-4806-ad93-f9d174f17900',
  10: 'ab9c186a-c52f-464b-2906-ca59d760a400',
  130: '2257980a-3463-48c6-cbac-a42d2a956e00',
  137: '41d04d42-da3b-4453-8506-668cc0727900',
  324: 'b310f07f-4ef7-49f3-7073-2a0a39685800',
  1_301: '4eeea7ef-0014-4649-5d1d-07271a80f600',
  8_453: '7289c336-3981-4081-c5f4-efc26ac64a00',
  10_143: '0a728e83-bacb-46db-7844-948f05434900',
  42_161: '3bff954d-5cb0-47a0-9a23-d20192e74600',
  42_220: 'ab781bbc-ccc6-418d-d32d-789b15da1f00',
  43_113: '30c46e53-e989-45fb-4549-be3bd4eb3b00',
  43_114: '30c46e53-e989-45fb-4549-be3bd4eb3b00',
  80_002: '41d04d42-da3b-4453-8506-668cc0727900',
  84_532: 'a18a7ecd-e307-4360-4746-283182228e00',
  111_551_111: 'e909ea0a-f92a-4512-c8fc-748044ea6800',
  11_155_420: 'ab9c186a-c52f-464b-2906-ca59d760a400',
  421_614: '3bff954d-5cb0-47a0-9a23-d20192e74600',
}

const chainIconOverrideByChainId: Record<
  number,
  { backgroundColor?: string; url: string }
> = {
  5_042_002: {
    backgroundColor: '#111817',
    url: 'https://cdn.prod.website-files.com/685311a976e7c248b5dfde95/699e21e934a48439675361dc_arc-icon.svg',
  },
}

const defaultChainId = 1

export const appChains = createAppChains()
export const defaultChainSlug =
  appChains.find((chain) => chain.id === defaultChainId && chain.batchAddress)
    ?.slug ??
  appChains.find((chain) => chain.batchAddress)?.slug ??
  appChains.find((chain) => chain.id === defaultChainId)?.slug ??
  appChains[0].slug
export const chainSlugs = appChains.map((chain) => chain.slug)
export const appKitNetworks = appChains.map((chain) => chain.wagmiChain) as [
  NumericAppKitNetwork,
  ...NumericAppKitNetwork[],
]

export const wagmiAdapter = new WagmiAdapter({
  networks: appKitNetworks,
  projectId: reownProjectId,
  transports: Object.fromEntries(
    appChains.map((chain) => [chain.id, http()]),
  ),
})

export const wagmiConfig = wagmiAdapter.wagmiConfig

export const appKit = createAppKit({
  adapters: [wagmiAdapter],
  defaultNetwork: getChainConfig(defaultChainSlug).wagmiChain,
  enableNetworkSwitch: false,
  features: {
    analytics: false,
    email: false,
    onramp: false,
    socials: false,
    swaps: false,
  },
  metadata: {
    description:
      'USDC Sender helps EVM wallet users send USDC to many addresses in one batch workflow.',
    icons: [`${appUrl}/favicon.svg`],
    name: 'USDC Sender',
    url: appUrl,
  },
  networks: appKitNetworks,
  projectId: reownProjectId,
  themeMode: 'light',
})

export function getChainConfig(slug: ChainSlug) {
  return appChains.find((chain) => chain.slug === slug) ?? appChains[0]
}

export function getChainConfigById(chainId?: number) {
  return appChains.find((chain) => chain.id === chainId)
}

export function resolveChainSlug(value: string): ChainSlug | null {
  const normalized = value.trim().toLowerCase()

  for (const chain of appChains) {
    if (chain.aliases.includes(normalized)) {
      return chain.slug
    }
  }

  return null
}

export function isConfiguredAddress(value: string): value is Address {
  return isAddress(value)
}

function createAppChains(): ChainConfig[] {
  const usedSlugs = new Map<string, number>()
  const chainGroups = new Map<
    number,
    {
      chain: NumericAppKitNetwork
      exportNames: string[]
      names: string[]
    }
  >()

  circleChainRegistry
    .filter((entry) => isNumericAppKitNetwork(entry[1]))
    .forEach(([exportName, chain]) => {
      const group = chainGroups.get(chain.id)

      if (group) {
        group.exportNames.push(exportName)
        group.names.push(chain.name)
        return
      }

      chainGroups.set(chain.id, {
        chain,
        exportNames: [exportName],
        names: [chain.name],
      })
    })

  return Array.from(chainGroups.values())
    .map(({ chain, exportNames, names }) => {
      const slug = createUniqueSlug(chain.name, usedSlugs)
      const explorerBaseUrl = chain.blockExplorers?.default?.url?.replace(/\/+$/, '')

      return {
        aliases: createChainAliases(chain, exportNames, names, slug),
        batchAddress: resolveBatchAddress(chain.id),
        defaultBatchSize: 100,
        explorerTxBaseUrl: explorerBaseUrl ? `${explorerBaseUrl}/tx` : '',
        id: chain.id,
        iconBackgroundColor: resolveChainIconBackgroundColor(chain.id),
        iconUrl: resolveChainIconUrl(chain.id),
        name: chain.name,
        shortName: createShortName(chain.name),
        slug,
        usdcAddress: resolveUsdcAddress(chain.id),
        wagmiChain: chain,
      }
    })
    .filter((chain) => Boolean(chain.usdcAddress && chain.batchAddress))
    .sort((left, right) => left.id - right.id)
}

function resolveChainIconUrl(chainId: number) {
  const override = chainIconOverrideByChainId[chainId]

  if (override) {
    return override.url
  }

  const imageId = reownNetworkImageIdByChainId[chainId]

  if (!imageId || !reownProjectId) {
    return ''
  }

  const url = new URL(`${reownAssetBaseUrl}/${imageId}`)

  url.searchParams.set('projectId', reownProjectId)
  url.searchParams.set('st', 'appkit')
  url.searchParams.set('sv', 'html-wagmi-4.2.2')

  return url.toString()
}

function resolveChainIconBackgroundColor(chainId: number) {
  return chainIconOverrideByChainId[chainId]?.backgroundColor
}

function createUniqueSlug(name: string, usedSlugs: Map<string, number>) {
  const baseSlug = slugify(name)
  const count = usedSlugs.get(baseSlug) ?? 0

  usedSlugs.set(baseSlug, count + 1)

  if (count === 0) {
    return baseSlug
  }

  return `${baseSlug}-${count + 1}`
}

function createChainAliases(
  chain: NumericAppKitNetwork,
  exportNames: string[],
  names: string[],
  slug: ChainSlug,
) {
  return Array.from(
    new Set([
      slug,
      chain.id.toString(),
      ...names.map((name) => name.toLowerCase()),
      ...exportNames.map((name) => name.toLowerCase()),
      ...exportNames.map((name) =>
        name.replace(/([a-z])([A-Z])/g, '$1-$2').toLowerCase(),
      ),
    ].filter((alias): alias is string => Boolean(alias))),
  )
}

function createShortName(name: string) {
  return name
    .replace(/\bMainnet\b/gi, '')
    .replace(/\bNetwork\b/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 18) || name.slice(0, 18)
}

function resolveBatchAddress(chainId: number) {
  return batchDistributorAddressByChainId[chainId] ?? ''
}

function resolveUsdcAddress(chainId: number): Address | null {
  return circleUsdcAddressByChainId[chainId] ?? null
}

function isNumericAppKitNetwork(value: unknown): value is NumericAppKitNetwork {
  return (
    typeof value === 'object' &&
    value !== null &&
    'id' in value &&
    typeof value.id === 'number' &&
    'name' in value &&
    typeof value.name === 'string' &&
    'nativeCurrency' in value &&
    typeof value.nativeCurrency === 'object' &&
    'rpcUrls' in value
  )
}

function createEdgeMainnet() {
  return defineChain({
    blockExplorers: {
      default: {
        name: 'EDGE Explorer',
        url: 'https://edge-mainnet.explorer.alchemy.com',
      },
    },
    id: 3_343,
    name: 'EDGE',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: ['https://edge-mainnet.g.alchemy.com/public'],
      },
    },
  }) as NumericAppKitNetwork
}

function createEdgeTestnet() {
  return defineChain({
    blockExplorers: {
      default: {
        name: 'EDGE Testnet Explorer',
        url: 'https://edge-testnet.explorer.alchemy.com',
      },
    },
    id: 33_431,
    name: 'EDGE Testnet',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: ['https://edge-testnet.g.alchemy.com/public'],
      },
    },
  }) as NumericAppKitNetwork
}

function createMorphHoodi() {
  return defineChain({
    blockExplorers: {
      default: {
        name: 'Morph Hoodi Explorer',
        url: 'https://explorer-hoodi.morphl2.io',
      },
    },
    id: 2_910,
    name: 'Morph Hoodi',
    nativeCurrency: {
      decimals: 18,
      name: 'Ether',
      symbol: 'ETH',
    },
    rpcUrls: {
      default: {
        http: ['https://rpc-hoodi.morph.network'],
      },
    },
  }) as NumericAppKitNetwork
}

function slugify(value: string) {
  return (
    value
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '') || 'network'
  )
}
