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

## Deploy Batch Contract

Set the matching RPC URL and `DEPLOYER_PRIVATE_KEY` in `.env`, then run one deploy per target network. The repo includes deployment targets for the current testnet validation set; add more networks to `hardhat.config.ts` before deploying there.

```bash
npm run deploy:batch -- --network arcTestnet
npm run deploy:batch -- --network baseSepolia
npm run deploy:batch -- --network ethereumSepolia
```

With CreateX deterministic deployment, set the shared address once:

```bash
VITE_REOWN_PROJECT_ID=...
VITE_BATCH_DISTRIBUTOR_ADDRESS=0x...
```

For a non-deterministic or temporary deploy, set per-chain addresses by numeric chain ID:

```bash
VITE_BATCH_1=0x...
VITE_BATCH_8453=0x...
VITE_BATCH_42161=0x...
```

`VITE_BATCH_DISTRIBUTOR_ADDRESS` takes precedence over the per-chain variables so a CreateX deployment can keep the same contract address across every configured chain.

USDC addresses for Circle-listed EVM mainnets and testnets are built in from Circle's official contract address list:

https://developers.circle.com/stablecoins/usdc-contract-addresses

The selector only shows EVM chains with a configured USDC address. If Circle adds or changes an address before the local config is updated, set an override:

```bash
VITE_USDC_<CHAIN_ID>=0x...
```

`VITE_REOWN_PROJECT_ID` is required for Reown AppKit WalletConnect support.

## Recipients

The Recipients editor uses this format:

```csv
address,amount
0xdc6456cb17ad2eb83f30661ad0559b137f956f39,1.25
0x4740aff788d498c7d3b9d8a433e098867c774438,0.5
```

Each batch run is limited to one selected blockchain network. Recipients do not include a chain column; the chain selector decides the target chain for every row.
If the input has more than 100 recipients, the DApp automatically splits it into multiple batches of at most 100 recipients each.
Batching is a frontend concern: each frontend batch gets a local `batchId` and is sent as one contract transaction.

The chain selector is generated from the local Circle USDC chain registry in `src/config/chains.ts`. Chains without a USDC token address are not shown.

Amounts are parsed as USDC with 6 decimals.

## User Flow

1. Connect an injected EVM wallet.
2. Select one blockchain network for the current batch run.
3. Import or edit the `address,amount` CSV rows.
4. Configure the shared CreateX batch contract address or a per-chain batch contract address.
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

The frontend chain selector lists every supported USDC chain with its chain ID, USDC address, configured batch contract address, and bytecode-check status. Refreshing a chain validates the configured batch contract bytecode before approving or sending.
