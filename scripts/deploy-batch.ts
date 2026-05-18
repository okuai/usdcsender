import { network } from "hardhat";

const { viem } = await network.create();
const [deployer] = await viem.getWalletClients();
const distributor = await viem.deployContract("BatchUSDCDistributor");

console.log("BatchUSDCDistributor deployed");
console.log("Deployer:", deployer.account.address);
console.log("Address:", distributor.address);
console.log("");
console.log("Add this address to batchDistributorAddressByChainId in src/config/chains.ts.");
