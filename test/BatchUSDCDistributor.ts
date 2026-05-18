import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { network } from "hardhat";
import { getAddress, parseUnits, zeroAddress } from "viem";

describe("BatchUSDCDistributor", async function () {
  const { viem } = await network.create();
  const publicClient = await viem.getPublicClient();

  async function deployFixture() {
    const [owner, recipientA, recipientB] = await viem.getWalletClients();
    const token = await viem.deployContract("MockUSDC");
    const distributor = await viem.deployContract("BatchUSDCDistributor");

    await token.write.mint([owner.account.address, parseUnits("1000", 6)]);

    return { distributor, owner, recipientA, recipientB, token };
  }

  it("sends different token amounts to multiple recipients", async function () {
    const { distributor, owner, recipientA, recipientB, token } =
      await deployFixture();
    const amountA = parseUnits("12.34", 6);
    const amountB = parseUnits("5", 6);
    const recipients = [recipientA.account.address, recipientB.account.address];
    const amounts = [amountA, amountB];

    await token.write.approve([distributor.address, amountA + amountB]);
    const txHash = await distributor.write.batchTransferFrom([
      token.address,
      recipients,
      amounts,
    ]);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    const events = await publicClient.getContractEvents({
      address: distributor.address,
      abi: distributor.abi,
      eventName: "BatchTransfer",
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
      strict: true,
    });

    assert.equal(
      await token.read.balanceOf([recipientA.account.address]),
      amountA,
    );
    assert.equal(
      await token.read.balanceOf([recipientB.account.address]),
      amountB,
    );
    assert.equal(
      await token.read.balanceOf([owner.account.address]),
      parseUnits("982.66", 6),
    );
    assert.equal(events.length, 1);
    assert.equal(getAddress(events[0].args.token), getAddress(token.address));
    assert.equal(
      getAddress(events[0].args.sender),
      getAddress(owner.account.address),
    );
    assert.equal(events[0].args.recipientCount, 2n);
    assert.equal(events[0].args.totalAmount, amountA + amountB);
  });

  it("rejects empty or malformed batches", async function () {
    const { distributor, recipientA, token } = await deployFixture();

    await assert.rejects(
      distributor.write.batchTransferFrom([
        zeroAddress,
        [recipientA.account.address],
        [1n],
      ]),
    );
    await assert.rejects(
      distributor.write.batchTransferFrom([token.address, [], []]),
    );
    await assert.rejects(
      distributor.write.batchTransferFrom([
        token.address,
        [recipientA.account.address],
        [],
      ]),
    );
    await assert.rejects(
      distributor.write.batchTransferFrom([token.address, [zeroAddress], [1n]]),
    );
    await assert.rejects(
      distributor.write.batchTransferFrom([
        token.address,
        [recipientA.account.address],
        [0n],
      ]),
    );
  });

  it("allows batches with more than 100 recipients", async function () {
    const { distributor, owner, token } = await deployFixture();
    const recipients = Array.from({ length: 101 }, (_, index) =>
      getAddress(`0x${(index + 1).toString(16).padStart(40, "0")}`),
    );
    const amounts = recipients.map(() => 1n);

    await token.write.approve([distributor.address, 101n]);
    const txHash = await distributor.write.batchTransferFrom([
      token.address,
      recipients,
      amounts,
    ]);
    const receipt = await publicClient.waitForTransactionReceipt({
      hash: txHash,
    });
    const events = await publicClient.getContractEvents({
      address: distributor.address,
      abi: distributor.abi,
      eventName: "BatchTransfer",
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber,
      strict: true,
    });

    assert.equal(events.length, 1);
    assert.equal(events[0].args.recipientCount, 101n);
    assert.equal(events[0].args.totalAmount, 101n);
    assert.equal(await token.read.balanceOf([recipients[0]]), 1n);
    assert.equal(await token.read.balanceOf([recipients[100]]), 1n);
    assert.equal(
      await token.read.balanceOf([owner.account.address]),
      parseUnits("1000", 6) - 101n,
    );
  });

  it("reverts the whole batch when allowance is insufficient", async function () {
    const { distributor, recipientA, recipientB, token } =
      await deployFixture();
    const amountA = parseUnits("8", 6);
    const amountB = parseUnits("9", 6);

    await token.write.approve([distributor.address, amountA]);

    await assert.rejects(
      distributor.write.batchTransferFrom([
        token.address,
        [recipientA.account.address, recipientB.account.address],
        [amountA, amountB],
      ]),
    );

    assert.equal(await token.read.balanceOf([recipientA.account.address]), 0n);
    assert.equal(await token.read.balanceOf([recipientB.account.address]), 0n);
  });

  it("reverts when balance is insufficient", async function () {
    const { distributor, recipientA, token } = await deployFixture();
    const amount = parseUnits("1001", 6);

    await token.write.approve([distributor.address, amount]);

    await assert.rejects(
      distributor.write.batchTransferFrom([
        token.address,
        [recipientA.account.address],
        [amount],
      ]),
    );
  });

  it("allows repeating the same recipients and amounts", async function () {
    const { distributor, recipientA, token } = await deployFixture();
    const amount = parseUnits("10", 6);

    await token.write.approve([distributor.address, amount * 2n]);
    await distributor.write.batchTransferFrom([
      token.address,
      [recipientA.account.address],
      [amount],
    ]);
    await distributor.write.batchTransferFrom([
      token.address,
      [recipientA.account.address],
      [amount],
    ]);

    assert.equal(
      await token.read.balanceOf([recipientA.account.address]),
      amount * 2n,
    );
  });
});
