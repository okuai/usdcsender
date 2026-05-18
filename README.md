# USDC Batch Sender

EVM DApp for sending ERC-20 USDC to many addresses.

## Stack

- Frontend: Vite, React, TypeScript, wagmi, viem
- Contracts: Solidity, OpenZeppelin, Hardhat 3, viem test runner
- Blockchain networks: Circle-listed EVM USDC networks from the official USDC contract address list

## Local Setup

```bash
npm install
cp .env.example .env
npm run compile:contracts
npm run test:contracts
npm run dev
```

## Cloudflare Pages

Use the Vite build output directly:

- Framework preset: Vite
- Build command: `npm run build`
- Build output directory: `dist`
- Node.js version: `22.16.0` (pinned by `.node-version`)
- Production environment variable: `VITE_REOWN_PROJECT_ID`

Do not add `DEPLOYER_PRIVATE_KEY` or RPC URL variables to Cloudflare Pages. Those are only needed locally when deploying contracts. The Batch contract and USDC token addresses used by the website are built into `src/config/chains.ts`.

The `public/_headers` file is copied into `dist` during `npm run build` and adds safe browser security headers plus long-lived caching for hashed Vite assets. The app does not require a Cloudflare Pages `_redirects` file.

## Deploy Batch Contract

Keep `DEPLOYER_PRIVATE_KEY` in `.env`, then inject the matching RPC URL only for the deploy command you are running. Mainnet targets are configured for Ethereum, Base, Ink, and Arbitrum One, plus the testnet validation set.

```bash
ETHEREUM_RPC_URL=https://... npm run deploy:batch:createx -- --network ethereum
BASE_RPC_URL=https://... npm run deploy:batch:createx -- --network base
INK_RPC_URL=https://... npm run deploy:batch:createx -- --network ink
ARBITRUM_ONE_RPC_URL=https://... npm run deploy:batch:createx -- --network arbitrumOne
ARC_TESTNET_RPC_URL=https://... npm run deploy:batch:createx -- --network arcTestnet
BASE_SEPOLIA_RPC_URL=https://... npm run deploy:batch:createx -- --network baseSepolia
ETHEREUM_SEPOLIA_RPC_URL=https://... npm run deploy:batch:createx -- --network ethereumSepolia
```

Batch contract addresses are built into `src/config/chains.ts` by numeric chain ID. Update `batchDistributorAddressByChainId` after deploying a supported network.

Current configured deployments:

| Network | Chain ID | Batch contract | Deploy transaction |
| --- | ---: | --- | --- |
| Ethereum | 1 | `0xE5C25B629D9f96be224604e4c03305965357d7E4` | `0xe2a0141d12ac731daadb1af9a568ab0c74f1f089db380f63b53e12b16b5e0867` |
| Base | 8453 | `0xE5C25B629D9f96be224604e4c03305965357d7E4` | `0x5524f340f09f2fc1c71ddd93e656e2144fbb8dd93810a52a58b028a67a0511bd` |
| Ink | 57073 | `0xE5C25B629D9f96be224604e4c03305965357d7E4` | `0x0c2693825f5243a462f9c69a2c265b7fab97c4d7a40ffc5436aa3086bcd779ed` |
| Arbitrum One | 42161 | `0xE5C25B629D9f96be224604e4c03305965357d7E4` | `0x119cb57378ede3bb36d36cb6eb3f35fd60916547f806f5109e617f70a8850c57` |
| Arc Testnet | 5042002 | `0xE5C25B629D9f96be224604e4c03305965357d7E4` | - |
| Base Sepolia | 84532 | `0xE5C25B629D9f96be224604e4c03305965357d7E4` | - |

USDC addresses for Circle-listed EVM mainnets and testnets are also built in from Circle's official contract address list:

https://developers.circle.com/stablecoins/usdc-contract-addresses

`VITE_REOWN_PROJECT_ID` is required for Reown AppKit WalletConnect support.

## Recipients

The Recipients editor uses this format:

```csv
address,amount
0x000000000000000000000000000000000000dEaD,0.01
```

Each batch run is limited to one selected blockchain network. Recipients do not include a chain column; the chain selector decides the target chain for every row.
If the input has more than 100 recipients, the DApp automatically splits it into multiple batches of at most 100 recipients each.
Batching is a frontend concern: each frontend batch gets a local `batchId` and is sent as one contract transaction.

The chain selector is generated from the deployed Batch contract table in `src/config/chains.ts`. Chains without both a USDC token address and a Batch contract address are hidden until the Batch contract is deployed and configured.

Amounts are parsed as USDC with 6 decimals.

## User Flow

1. Connect an injected EVM wallet.
2. Select one blockchain network for the current batch run.
3. Import or edit the `address,amount` CSV rows.
4. Review the built-in Batch contract address for the selected network.
5. Read balance and allowance automatically, or refresh manually.
6. Approve the remaining USDC amount when needed.
7. Send the next transaction group or all remaining groups.
8. Export recipients as the same `address,amount` CSV format used for import.

## Send Monitoring

The contract exposes one simple token sender function:

```solidity
batchTransferFrom(address token, address[] recipients, uint256[] amounts)
```

Each successful call emits `BatchTransfer(sender, token, recipientCount, totalAmount)`.
The `sender` and `token` fields are indexed for cheap log filtering. The contract first pulls the exact batch total from the sender, then sends each recipient amount from the contract in the same atomic transaction.
The contract does not store or validate batch IDs. The DApp tracks local send history in IndexedDB by frontend `batchId`, transaction hash, status, recipient count, total USDC, and explorer link.

The contract is intentionally ownerless, non-upgradeable, constructor-free, and token-address parameterized so the same bytecode can be deployed on every EVM chain. For deterministic deployment through CreateX, compile first and run:

```bash
npm run compile:contracts
npm run deploy:batch:createx -- --network <network>
```

The frontend chain selector lists every deployed USDC chain with its chain ID, USDC address, configured batch contract address, and bytecode-check status. Refreshing a chain validates the configured batch contract bytecode before approving or sending.
