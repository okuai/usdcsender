import { readFileSync } from "node:fs";

import { network } from "hardhat";
import {
  concatHex,
  getContractAddress,
  keccak256,
  padHex,
  type Address,
  type Hex,
} from "viem";

const CREATE_X_ADDRESS = "0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed";

const createXAbi = [
  {
    type: "function",
    name: "deployCreate2",
    stateMutability: "payable",
    inputs: [
      { name: "salt", type: "bytes32" },
      { name: "initCode", type: "bytes" },
    ],
    outputs: [{ name: "newContract", type: "address" }],
  },
] as const;

type ContractArtifact = {
  bytecode: Hex;
  deployedBytecode: Hex;
};

const { viem } = await network.create();
const publicClient = await viem.getPublicClient();
const [deployer] = await viem.getWalletClients();

const artifact = JSON.parse(
  readFileSync(
    "artifacts/contracts/BatchUSDCDistributor.sol/BatchUSDCDistributor.json",
    "utf8",
  ),
) as ContractArtifact;

const initCode = artifact.bytecode;
const runtimeHash = keccak256(artifact.deployedBytecode);
const salt = buildCreateXSalt(deployer.account.address);
const guardedSalt = keccak256(
  concatHex([padHex(deployer.account.address, { size: 32 }), salt]),
);
const expectedAddress = getContractAddress({
  bytecode: initCode,
  from: CREATE_X_ADDRESS,
  opcode: "CREATE2",
  salt: guardedSalt,
});

const createXCode = await publicClient.getCode({ address: CREATE_X_ADDRESS });

if (!createXCode || createXCode === "0x") {
  throw new Error(
    `CreateX is not deployed on this network at ${CREATE_X_ADDRESS}`,
  );
}

const existingCode = await publicClient.getCode({ address: expectedAddress });

console.log("BatchUSDCDistributor deterministic deployment");
console.log("Deployer:", deployer.account.address);
console.log("CreateX:", CREATE_X_ADDRESS);
console.log("Salt:", salt);
console.log("Expected address:", expectedAddress);
console.log("Runtime bytecode hash:", runtimeHash);

if (existingCode && existingCode !== "0x") {
  const existingHash = keccak256(existingCode);
  console.log("Existing bytecode hash:", existingHash);

  if (existingHash !== runtimeHash) {
    throw new Error("Expected address already contains different bytecode");
  }

  console.log("Contract already deployed with the expected bytecode.");
  process.exit(0);
}

const hash = await deployer.writeContract({
  abi: createXAbi,
  address: CREATE_X_ADDRESS,
  functionName: "deployCreate2",
  args: [salt, initCode],
});

console.log("Deploy tx:", hash);

await publicClient.waitForTransactionReceipt({ hash });

const deployedCode = await publicClient.getCode({ address: expectedAddress });

if (!deployedCode || deployedCode === "0x") {
  throw new Error("Deployment confirmed but no bytecode was found");
}

const deployedHash = keccak256(deployedCode);

if (deployedHash !== runtimeHash) {
  throw new Error("Deployment confirmed but runtime bytecode hash mismatched");
}

console.log("Contract deployed:", expectedAddress);
console.log("");
console.log("Set the matching Vite env var or paste this address in the UI.");

function buildCreateXSalt(deployerAddress: Address) {
  const entropy = keccak256(
    new TextEncoder().encode("usdcsender.batch-usdc-distributor.v1"),
  ).slice(2, 24);

  return `${deployerAddress.toLowerCase()}00${entropy}` as Hex;
}
