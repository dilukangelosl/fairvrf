import { describe, it } from "node:test";
import { expect } from "chai";
import { network } from "hardhat";
import { keccak256, toHex } from "viem";

const { viem, networkHelpers } = await network.connect();

// Hash chain for testing
const secret = toHex(keccak256(toHex("SECRET_SEED")));
const s1 = keccak256(secret);
const s0 = keccak256(s1); // anchor

async function deployConsumerFixture() {
  const [owner, user1] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  // 1. Deploy FairVRF
  const fairVRF = await viem.deployContract("FairVRF", [owner.account.address]);
  await fairVRF.write.setAnchor([s0]);

  // 2. Deploy Adapter
  const adapter = await viem.deployContract("PythToFairVRFAdapter", [
    fairVRF.address,
  ]);

  // 3. Deploy Example Consumer
  const consumer = await viem.deployContract("PythExampleConsumer", [
    adapter.address
  ]);

  return {
    consumer,
    adapter,
    fairVRF,
    owner,
    user1,
    publicClient,
  };
}

describe("PythExampleConsumer", () => {
  it("Should successfully request and receive randomness via Adapter", async () => {
    const { consumer, adapter, fairVRF, owner, user1, publicClient } = 
      await networkHelpers.loadFixture(deployConsumerFixture);

    // 1. Request randomness
    // We send a bit of ETH just in case, though fee is 0 in adapter
    const tx = await consumer.write.requestRandomness([], {
      account: user1.account,
      value: BigInt("10000000000000000") // 0.01 ETH
    });
    await publicClient.waitForTransactionReceipt({ hash: tx });

    // Verify events
    const requestEvents = await consumer.getEvents.RandomnessRequested();
    expect(requestEvents.length).to.equal(1);
    const sequenceNumber = (requestEvents[0].args as any).sequenceNumber!;
    expect(sequenceNumber).to.equal(1n);

    // Adapter should have emitted event too
    const adapterEvents = await adapter.getEvents.RandomnessRequested();
    expect(adapterEvents.length).to.equal(1);

    // FairVRF should have request
    const fairVRFEvents = await fairVRF.getEvents.RandomWordsRequested();
    expect(fairVRFEvents.length).to.equal(1);
    const requestId = (fairVRFEvents[0].args as any).requestId!;

    // 2. Fulfill randomness (FairVRF owner does this)
    const fulfillTx = await fairVRF.write.fulfillRandomness([requestId, s1], {
      account: owner.account
    });
    await publicClient.waitForTransactionReceipt({ hash: fulfillTx });

    // 3. Verify callback
    const completeEvents = await consumer.getEvents.RandomnessReceived();
    expect(completeEvents.length).to.equal(1);
    expect((completeEvents[0].args as any).sequenceNumber).to.equal(sequenceNumber);
    
    // Check stored result
    const isFulfilled = await consumer.read.requestFulfilled([sequenceNumber]);
    expect(isFulfilled).to.be.true;
    
    const randomValue = await consumer.read.randomResults([sequenceNumber]);
    expect(randomValue).to.not.equal(toHex("0x0000000000000000000000000000000000000000000000000000000000000000"));
  });
});
