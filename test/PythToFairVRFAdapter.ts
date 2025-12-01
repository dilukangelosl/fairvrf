import { describe, it } from "node:test";
import { expect } from "chai";
import { network } from "hardhat";
import { keccak256, toHex } from "viem";

const { viem, networkHelpers } = await network.connect();

// Create a proper hash chain for testing
const secret = toHex(keccak256(toHex("SECRET_SEED"))); // s3
const s2 = keccak256(secret);
const s1 = keccak256(s2);
const s0 = keccak256(s1); // anchor

async function deployAdapterFixture() {
  const [owner, user1, user2] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  // Deploy FairVRF coordinator first (owner is the fulfiller)
  const fairVRF = await viem.deployContract("FairVRF", [owner.account.address]);

  // Set proper anchor from hash chain
  await fairVRF.write.setAnchor([s0]);

  // Deploy the adapter
  const adapter = await viem.deployContract("PythToFairVRFAdapter", [
    fairVRF.address,
  ]);

  return {
    adapter,
    fairVRF,
    owner,
    user1,
    user2,
    publicClient,
  };
}

describe("PythToFairVRFAdapter", () => {
  describe("Deployment", () => {
    it("Should deploy with correct FairVRF coordinator", async () => {
      const { adapter, fairVRF } = await networkHelpers.loadFixture(
        deployAdapterFixture
      );

      expect((await adapter.read.COORDINATOR()).toLowerCase()).to.equal(
        fairVRF.address.toLowerCase()
      );
    });
  });

  describe("Fee Handling", () => {
    it("Should return zero fee for any gas limit", async () => {
      const { adapter } = await networkHelpers.loadFixture(
        deployAdapterFixture
      );

      expect(await adapter.read.getFeeV2([100000])).to.equal(0n);
      expect(await adapter.read.getFeeV2([500000])).to.equal(0n);
      expect(await adapter.read.getFeeV2([1000000])).to.equal(0n);
    });

    it("Should refund ETH sent with requests", async () => {
      const { adapter, user1, publicClient } = await networkHelpers.loadFixture(
        deployAdapterFixture
      );

      const initialBalance = await publicClient.getBalance({
        address: user1.account.address,
      });

      // Send 0.1 ETH with request
      const tx = await adapter.write.requestV2([500000], {
        account: user1.account,
        value: BigInt("100000000000000000"), // 0.1 ETH in wei
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: tx,
      });
      const finalBalance = await publicClient.getBalance({
        address: user1.account.address,
      });

      const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;

      // Should only lose gas, ETH should be refunded
      const actualLoss = initialBalance - finalBalance;
      const diff = actualLoss > gasUsed ? actualLoss - gasUsed : gasUsed - actualLoss;
      expect(diff < BigInt("1000000000000000")).to.be.true; // Within 0.001 ETH
    });
  });

  describe("Request Translation", () => {
    it("Should translate Pyth requests to FairVRF requests", async () => {
      const { adapter, fairVRF, user1, publicClient } =
        await networkHelpers.loadFixture(deployAdapterFixture);

      const gasLimit = 500000;
      const tx = await adapter.write.requestV2([gasLimit], {
        account: user1.account,
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });

      const events = await fairVRF.getEvents.RandomWordsRequested();
      expect(events.length).to.equal(1);
      expect(events[0].args.requestId).to.equal(1n);
      expect(Number(events[0].args.callbackGasLimit)).to.equal(gasLimit);
      expect(events[0].args.numWords).to.equal(1);
    });

    it("Should emit RandomnessRequested event with sequence number", async () => {
      const { adapter, user1, publicClient } = await networkHelpers.loadFixture(
        deployAdapterFixture
      );

      const tx = await adapter.write.requestV2([500000], {
        account: user1.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });

      const events = await adapter.getEvents.RandomnessRequested();
      expect(events.length).to.equal(1);
      expect(events[0].args.sequenceNumber).to.equal(1n);
      expect(events[0].args.consumer!.toLowerCase()).to.equal(
        user1.account.address.toLowerCase()
      );
    });

    it("Should increment sequence numbers", async () => {
      const { adapter, user1, user2, publicClient } =
        await networkHelpers.loadFixture(deployAdapterFixture);

      // First request
      const tx1 = await adapter.write.requestV2([500000], {
        account: user1.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx1 });

      // Second request  
      const tx2 = await adapter.write.requestV2([400000], {
        account: user2.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx2 });

      // Get all events
      const events = await publicClient.getContractEvents({
        address: adapter.address,
        abi: adapter.abi,
        eventName: "RandomnessRequested",
        fromBlock: 0n,
      });

      expect(events.length).to.equal(2);
      expect(events[0].args.sequenceNumber).to.equal(1n);
      expect(events[1].args.sequenceNumber).to.equal(2n);
    });

    it("Should store consumer and gas limit mapping", async () => {
      const { adapter, user1 } = await networkHelpers.loadFixture(
        deployAdapterFixture
      );

      await adapter.write.requestV2([500000], { account: user1.account });

      expect((await adapter.read.sequenceToConsumer([1n])).toLowerCase()).to.equal(
        user1.account.address.toLowerCase()
      );
      expect(Number(await adapter.read.sequenceToGasLimit([1n]))).to.equal(500000);
    });

    it("Should store bidirectional ID mapping", async () => {
      const { adapter, user1 } = await networkHelpers.loadFixture(
        deployAdapterFixture
      );

      await adapter.write.requestV2([500000], { account: user1.account });

      // FairVRF request ID 1 should map to sequence 1
      expect(await adapter.read.fairVRFToSequence([1n])).to.equal(1n);
      expect(await adapter.read.sequenceToFairVRF([1n])).to.equal(1n);
    });
  });

  describe("Error Handling", () => {
    it("Should handle non-existent request gracefully", async () => {
      const { fairVRF, owner } = await networkHelpers.loadFixture(
        deployAdapterFixture
      );

      // Try to fulfill non-existent request - should revert with RequestNotFound
      await viem.assertions.revertWithCustomError(
        fairVRF.write.fulfillRandomness([999n, keccak256(toHex("random"))], {
          account: owner.account,
        }),
        fairVRF,
        "RequestNotFound"
      );
    });
  });

  describe("Integration", () => {
    it("Should work end-to-end with real FairVRF fulfillment", async () => {
      const { adapter, fairVRF, user1, owner, publicClient } =
        await networkHelpers.loadFixture(deployAdapterFixture);

      // Make request through adapter
      const tx = await adapter.write.requestV2([500000], {
        account: user1.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx });

      // Check that FairVRF received the request
      const fairVRFEvents = await fairVRF.getEvents.RandomWordsRequested();
      expect(fairVRFEvents.length).to.equal(1);
      expect(fairVRFEvents[0].args.requestId).to.equal(1n);

      // Fulfill through FairVRF using the proper next seed (s1)
      const fulfillTx = await fairVRF.write.fulfillRandomness([1n, s1], {
        account: owner.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: fulfillTx });

      // Verify fulfillment was successful
      const fulfillEvents = await fairVRF.getEvents.RandomWordsFulfilled();
      expect(fulfillEvents.length).to.equal(1);
      expect(fulfillEvents[0].args.success).to.equal(true);

      // Verify mappings were cleaned up
      expect(await adapter.read.fairVRFToSequence([1n])).to.equal(0n);
      expect(await adapter.read.sequenceToConsumer([1n])).to.equal(
        "0x0000000000000000000000000000000000000000"
      );
    });

    it("Should handle multiple concurrent requests", async () => {
      const { adapter, fairVRF, user1, user2, owner, publicClient } =
        await networkHelpers.loadFixture(deployAdapterFixture);

      // Make multiple requests
      const tx1 = await adapter.write.requestV2([500000], {
        account: user1.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx1 });

      const tx2 = await adapter.write.requestV2([400000], {
        account: user2.account,
      });
      await publicClient.waitForTransactionReceipt({ hash: tx2 });

      // Verify both requests were created
      const fairVRFEvents = await publicClient.getContractEvents({
        address: fairVRF.address,
        abi: fairVRF.abi,
        eventName: "RandomWordsRequested",
        fromBlock: 0n,
      });
      expect(fairVRFEvents.length).to.equal(2);

      // Fulfill request 1 with s1 (next seed from s0)
      const tx3 = await fairVRF.write.fulfillRandomness([1n, s1], {
        account: owner.account,
      });
      const receipt3 = await publicClient.waitForTransactionReceipt({ hash: tx3 });
      expect(receipt3.status).to.equal("success");

      // Fulfill request 2 with s2 (next seed from s1)
      const tx4 = await fairVRF.write.fulfillRandomness([2n, s2], {
        account: owner.account,
      });
      const receipt4 = await publicClient.waitForTransactionReceipt({ hash: tx4 });
      expect(receipt4.status).to.equal("success");

      // Verify both were fulfilled - check individually
      const logs3 = await publicClient.getContractEvents({
        address: fairVRF.address,
        abi: fairVRF.abi,
        eventName: 'RandomWordsFulfilled',
        fromBlock: receipt3.blockNumber,
        toBlock: receipt3.blockNumber,
      });
      expect(logs3.length).to.equal(1);

      const logs4 = await publicClient.getContractEvents({
        address: fairVRF.address,
        abi: fairVRF.abi,
        eventName: 'RandomWordsFulfilled',
        fromBlock: receipt4.blockNumber,
        toBlock: receipt4.blockNumber,
      });
      expect(logs4.length).to.equal(1);
    });
  });

  describe("Gas Optimization", () => {
    it("Should use reasonable gas for request translation", async () => {
      const { adapter, user1, publicClient } = await networkHelpers.loadFixture(
        deployAdapterFixture
      );

      const tx = await adapter.write.requestV2([500000], {
        account: user1.account,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: tx,
      });

      // Should use less than 220k gas for translation (updated expectation)
      expect(Number(receipt.gasUsed)).to.be.lessThan(220000);
    });

    it("Should use reasonable gas for callback forwarding", async () => {
      const { adapter, fairVRF, user1, owner, publicClient } =
        await networkHelpers.loadFixture(deployAdapterFixture);

      await adapter.write.requestV2([500000], { account: user1.account });

      const tx = await fairVRF.write.fulfillRandomness([1n, s1], {
        account: owner.account,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: tx,
      });

      // Callback forwarding should be efficient
      expect(Number(receipt.gasUsed)).to.be.lessThan(600000);
    });
  });

  describe("Emergency Functions", () => {
    it("Should refund ETH sent directly to contract", async () => {
      const { adapter, user1, publicClient } = await networkHelpers.loadFixture(
        deployAdapterFixture
      );

      const initialBalance = await publicClient.getBalance({
        address: user1.account.address,
      });

      const tx = await user1.sendTransaction({
        to: adapter.address,
        value: BigInt("100000000000000000"), // 0.1 ETH
        account: user1.account,
      });
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: tx,
      });

      const finalBalance = await publicClient.getBalance({
        address: user1.account.address,
      });
      const gasUsed = receipt.gasUsed * receipt.effectiveGasPrice;

      // Should only lose gas, ETH should be refunded
      const actualLoss = initialBalance - finalBalance;
      const diff = actualLoss > gasUsed ? actualLoss - gasUsed : gasUsed - actualLoss;
      expect(diff < BigInt("1000000000000000")).to.be.true; // Within 0.001 ETH
    });
  });
});
