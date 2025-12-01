import { describe, it } from "node:test";
import { expect } from "chai";
import { network } from "hardhat";
import { keccak256, toHex } from "viem";

const { viem, networkHelpers } = await network.connect();

//
// SEEDS
//
const secret = toHex(keccak256(toHex("SECRET_SEED"))); // s3
const s2 = keccak256(secret);
const s1 = keccak256(s2);
const s0 = keccak256(s1); // anchor

//
// FIXTURE FUNCTION
//
async function deployFairVRFFixture() {
  const [owner, fulfiller, user] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  const fairVRF = await viem.deployContract("FairVRF", [
    fulfiller.account.address,
  ]);

  await fairVRF.write.setAnchor([s0]);

  return { fairVRF, owner, fulfiller, user, publicClient };
}

describe("FairVRF", () => {
  it("Should deploy with correct fulfiller + anchor", async () => {
    const { fairVRF, fulfiller } = await networkHelpers.loadFixture(
      deployFairVRFFixture
    );

    const fulfillerStored = await fairVRF.read.fulfiller();
    expect(fulfillerStored.toLowerCase()).to.equal(
      fulfiller.account.address.toLowerCase()
    );

    const anchor = await fairVRF.read.currentAnchor();
    expect(anchor).to.equal(s0);
  });

  //
  // CHAINLINK STYLE
  //
  describe("Chainlink Style", () => {
    it("Should emit RandomWordsRequested event", async () => {
      const { fairVRF, user, publicClient } = await networkHelpers.loadFixture(
        deployFairVRFFixture
      );

      const tx = await fairVRF.write.requestRandomWords(
        [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          0n,
          3,
          100000,
          1,
        ],
        { account: user.account }
      );

      await publicClient.waitForTransactionReceipt({ hash: tx });

      const events = await fairVRF.getEvents.RandomWordsRequested();
      expect(events.length).to.equal(1);
      expect(events[0].args.requestId).to.equal(1n);
      expect(events[0].args.sender!.toLowerCase()).to.equal(
        user.account.address.toLowerCase()
      );
    });

    it("Should fulfill randomness with valid seed (s1)", async () => {
      const { fairVRF, user, fulfiller, publicClient } =
        await networkHelpers.loadFixture(deployFairVRFFixture);

      await fairVRF.write.requestRandomWords(
        [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          0n,
          3,
          500000,
          1,
        ],
        { account: user.account }
      );

      const tx = await fairVRF.write.fulfillRandomness([1n, s1], {
        account: fulfiller.account,
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });

      const ev = await fairVRF.getEvents.RandomWordsFulfilled();
      expect(ev[0].args.success).to.equal(true);

      const newAnchor = await fairVRF.read.currentAnchor();
      expect(newAnchor).to.equal(s1);
    });

    it("Should revert wrong seed", async () => {
      const { fairVRF, user, fulfiller } = await networkHelpers.loadFixture(
        deployFairVRFFixture
      );

      await fairVRF.write.requestRandomWords(
        [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          0n,
          3,
          500000,
          1,
        ],
        { account: user.account }
      );

      await viem.assertions.revertWithCustomError(
        fairVRF.write.fulfillRandomness([1n, s2], {
          account: fulfiller.account,
        }),
        fairVRF,
        "InvalidSeedProof"
      );
    });
  });

  //
  // PYTH STYLE
  //
  describe("Pyth Style", () => {
    it("Should request via requestWithCallback", async () => {
      const { fairVRF, user, publicClient } = await networkHelpers.loadFixture(
        deployFairVRFFixture
      );

      const tx = await fairVRF.write.requestWithCallback(
        [
          fairVRF.address,
          "0x1234567890123456789012345678901234567890123456789012345678901234",
        ],
        { account: user.account }
      );

      await publicClient.waitForTransactionReceipt({ hash: tx });

      const ev = await fairVRF.getEvents.RandomWordsRequested();
      expect(ev.length).to.equal(1);
    });

    it("Should fulfill Pyth request", async () => {
      const { fairVRF, user, fulfiller, publicClient } =
        await networkHelpers.loadFixture(deployFairVRFFixture);

      await fairVRF.write.requestWithCallback(
        [
          fairVRF.address,
          "0x1234000000000000000000000000000000000000000000000000000000000000",
        ],
        { account: user.account }
      );

      const tx = await fairVRF.write.fulfillRandomness([1n, s1], {
        account: fulfiller.account,
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });

      const ev = await fairVRF.getEvents.RandomWordsFulfilled();
      expect(ev[0].args.success).to.equal(true);
    });
  });

  //
  // ADMIN FUNCTIONS
  //
  describe("Admin Functions", () => {
    it("Should allow owner to update fulfiller", async () => {
      const { fairVRF, owner, user } = await networkHelpers.loadFixture(
        deployFairVRFFixture
      );

      // Update fulfiller to user address
      await fairVRF.write.setFulfiller([user.account.address], {
        account: owner.account,
      });

      const newFulfiller = await fairVRF.read.fulfiller();
      expect(newFulfiller.toLowerCase()).to.equal(
        user.account.address.toLowerCase()
      );
    });

    it("Should revert when non-owner tries to update fulfiller", async () => {
      const { fairVRF, user, fulfiller } = await networkHelpers.loadFixture(
        deployFairVRFFixture
      );

      await viem.assertions.revertWithCustomError(
        fairVRF.write.setFulfiller([user.account.address], {
          account: user.account,
        }),
        fairVRF,
        "OwnableUnauthorizedAccount"
      );
    });

    it("Should allow owner to update anchor", async () => {
      const { fairVRF, owner } = await networkHelpers.loadFixture(
        deployFairVRFFixture
      );

      const newAnchor = keccak256(
        "0x1234567890123456789012345678901234567890123456789012345678901234"
      );

      await fairVRF.write.setAnchor([newAnchor], {
        account: owner.account,
      });

      const updatedAnchor = await fairVRF.read.currentAnchor();
      expect(updatedAnchor).to.equal(newAnchor);
    });

    it("Should revert when non-owner tries to update anchor", async () => {
      const { fairVRF, user } = await networkHelpers.loadFixture(
        deployFairVRFFixture
      );

      const newAnchor = keccak256(
        "0x1234567890123456789012345678901234567890123456789012345678901234"
      );

      await viem.assertions.revertWithCustomError(
        fairVRF.write.setAnchor([newAnchor], {
          account: user.account,
        }),
        fairVRF,
        "OwnableUnauthorizedAccount"
      );
    });

    it("Should emit AnchorUpdated event when anchor is changed", async () => {
      const { fairVRF, owner, publicClient } = await networkHelpers.loadFixture(
        deployFairVRFFixture
      );

      const oldAnchor = await fairVRF.read.currentAnchor();
      const newAnchor = keccak256(
        "0x1234567890123456789012345678901234567890123456789012345678901234"
      );

      const tx = await fairVRF.write.setAnchor([newAnchor], {
        account: owner.account,
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });

      const events = await fairVRF.getEvents.AnchorUpdated();
      expect(events.length).to.equal(1);
      expect(events[0].args.oldAnchor).to.equal(oldAnchor);
      expect(events[0].args.newAnchor).to.equal(newAnchor);
    });
  });

  //
  // ERROR HANDLING
  //
  describe("Error Handling", () => {
    it("Should revert fulfillment with wrong fulfiller", async () => {
      const { fairVRF, user } = await networkHelpers.loadFixture(
        deployFairVRFFixture
      );

      await fairVRF.write.requestRandomWords(
        [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          0n,
          3,
          500000,
          1,
        ],
        { account: user.account }
      );

      await viem.assertions.revertWithCustomError(
        fairVRF.write.fulfillRandomness([1n, s1], {
          account: user.account, // Wrong account (not fulfiller)
        }),
        fairVRF,
        "OnlyFulfiller"
      );
    });

    it("Should revert fulfillment for non-existent request", async () => {
      const { fairVRF, fulfiller } = await networkHelpers.loadFixture(
        deployFairVRFFixture
      );

      await viem.assertions.revertWithCustomError(
        fairVRF.write.fulfillRandomness([999n, s1], {
          account: fulfiller.account,
        }),
        fairVRF,
        "RequestNotFound"
      );
    });

    it("Should revert double fulfillment", async () => {
      const { fairVRF, user, fulfiller } = await networkHelpers.loadFixture(
        deployFairVRFFixture
      );

      await fairVRF.write.requestRandomWords(
        [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          0n,
          3,
          500000,
          1,
        ],
        { account: user.account }
      );

      // First fulfillment
      await fairVRF.write.fulfillRandomness([1n, s1], {
        account: fulfiller.account,
      });

      // Second fulfillment should revert
      await viem.assertions.revertWithCustomError(
        fairVRF.write.fulfillRandomness([1n, s2], {
          account: fulfiller.account,
        }),
        fairVRF,
        "AlreadyFulfilled"
      );
    });

    it("Should handle multiple numWords correctly", async () => {
      const { fairVRF, user, fulfiller, publicClient } =
        await networkHelpers.loadFixture(deployFairVRFFixture);

      await fairVRF.write.requestRandomWords(
        [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          0n,
          3,
          500000,
          5,
        ], // 5 words
        { account: user.account }
      );

      const tx = await fairVRF.write.fulfillRandomness([1n, s1], {
        account: fulfiller.account,
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });

      const ev = await fairVRF.getEvents.RandomWordsFulfilled();
      expect(ev[0].args.success).to.equal(true);
    });

    it("Should handle zero numWords", async () => {
      const { fairVRF, user } = await networkHelpers.loadFixture(
        deployFairVRFFixture
      );

      await fairVRF.write.requestRandomWords(
        [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          0n,
          3,
          500000,
          0,
        ], // 0 words
        { account: user.account }
      );

      // Should still create request
      const events = await fairVRF.getEvents.RandomWordsRequested();
      expect(events.length).to.equal(1);
      expect(events[0].args.numWords).to.equal(0);
    });
  });

  //
  // VERIFICATION TESTS
  //
  describe("Verification", () => {
    it("Should verify randomness correctly", async () => {
      const { fairVRF, user, fulfiller, publicClient } =
        await networkHelpers.loadFixture(deployFairVRFFixture);

      await fairVRF.write.requestRandomWords(
        [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          0n,
          3,
          500000,
          2,
        ],
        { account: user.account }
      );

      await fairVRF.write.fulfillRandomness([1n, s1], {
        account: fulfiller.account,
      });

      const [isValid, randomWords] = await fairVRF.read.verifyRandomness([
        1n,
        s1,
      ]);
      expect(isValid).to.equal(true);
      expect(randomWords.length).to.equal(2);
    });

    it("Should return false for invalid seed verification", async () => {
      const { fairVRF, user } = await networkHelpers.loadFixture(
        deployFairVRFFixture
      );

      await fairVRF.write.requestRandomWords(
        [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          0n,
          3,
          500000,
          1,
        ],
        { account: user.account }
      );

      // Try to verify with wrong seed
      const [isValid] = await fairVRF.read.verifyRandomness([1n, s2]);
      expect(isValid).to.equal(false);
    });

    it("Should return false for non-existent request verification", async () => {
      const { fairVRF } = await networkHelpers.loadFixture(
        deployFairVRFFixture
      );

      const [isValid] = await fairVRF.read.verifyRandomness([999n, s1]);
      expect(isValid).to.equal(false);
    });
  });

  //
  // SEQUENTIAL PROCESSING TESTS
  //
  describe("Sequential Processing", () => {
    it("Should process multiple requests sequentially", async () => {
      const { fairVRF, user, fulfiller, publicClient } =
        await networkHelpers.loadFixture(deployFairVRFFixture);

      // Request 1
      await fairVRF.write.requestRandomWords(
        [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          0n,
          3,
          500000,
          1,
        ],
        { account: user.account }
      );

      // Request 2
      await fairVRF.write.requestRandomWords(
        [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          0n,
          3,
          500000,
          1,
        ],
        { account: user.account }
      );

      // Fulfill request 1
      await fairVRF.write.fulfillRandomness([1n, s1], {
        account: fulfiller.account,
      });

      let anchor = await fairVRF.read.currentAnchor();
      expect(anchor).to.equal(s1);

      // Fulfill request 2
      await fairVRF.write.fulfillRandomness([2n, s2], {
        account: fulfiller.account,
      });

      anchor = await fairVRF.read.currentAnchor();
      expect(anchor).to.equal(s2);
    });

    it("Should revert if trying to skip sequence", async () => {
      const { fairVRF, user, fulfiller } = await networkHelpers.loadFixture(
        deployFairVRFFixture
      );

      // Request 1
      await fairVRF.write.requestRandomWords(
        [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          0n,
          3,
          500000,
          1,
        ],
        { account: user.account }
      );

      // Request 2
      await fairVRF.write.requestRandomWords(
        [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          0n,
          3,
          500000,
          1,
        ],
        { account: user.account }
      );

      // Try to fulfill request 2 with wrong seed (s2 instead of s1)
      await viem.assertions.revertWithCustomError(
        fairVRF.write.fulfillRandomness([2n, s2], {
          account: fulfiller.account,
        }),
        fairVRF,
        "InvalidSeedProof"
      );
    });
  });

  //
  // GAS OPTIMIZATION TESTS
  //
  describe("Gas Optimization", () => {
    it("Should have reasonable gas costs for requests", async () => {
      const { fairVRF, user, publicClient } = await networkHelpers.loadFixture(
        deployFairVRFFixture
      );

      const tx = await fairVRF.write.requestRandomWords(
        [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          0n,
          3,
          100000,
          1,
        ],
        { account: user.account }
      );

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: tx,
      });

      // Gas should be reasonable (less than 110k for request)
      expect(Number(receipt.gasUsed)).to.be.lessThan(110000);
    });

    it("Should have reasonable gas costs for fulfillment", async () => {
      const { fairVRF, user, fulfiller, publicClient } =
        await networkHelpers.loadFixture(deployFairVRFFixture);

      await fairVRF.write.requestRandomWords(
        [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          0n,
          3,
          500000,
          1,
        ],
        { account: user.account }
      );

      const tx = await fairVRF.write.fulfillRandomness([1n, s1], {
        account: fulfiller.account,
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: tx,
      });

      // Fulfillment should be very gas efficient (less than 80k)
      expect(Number(receipt.gasUsed)).to.be.lessThan(80000);
    });
  });

  //
  // EDGE CASES
  //
  describe("Edge Cases", () => {
    it("Should handle requests with different confirmation blocks", async () => {
      const { fairVRF, user } = await networkHelpers.loadFixture(
        deployFairVRFFixture
      );

      // Different confirmation requirements
      await fairVRF.write.requestRandomWords(
        [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          0n,
          1,
          100000,
          1,
        ],
        { account: user.account }
      );

      const events = await fairVRF.getEvents.RandomWordsRequested();
      expect(events.length).to.equal(1);
      expect(events[0].args.minimumRequestConfirmations).to.equal(1);
    });

    it("Should handle different callback gas limits", async () => {
      const { fairVRF, user } = await networkHelpers.loadFixture(
        deployFairVRFFixture
      );

      await fairVRF.write.requestRandomWords(
        [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          0n,
          3,
          50000,
          1,
        ],
        { account: user.account }
      );

      const events = await fairVRF.getEvents.RandomWordsRequested();
      expect(events.length).to.equal(1);
      expect(events[0].args.callbackGasLimit).to.equal(50000);
    });

    it("Should handle maximum uint256 values", async () => {
      const { fairVRF, user } = await networkHelpers.loadFixture(
        deployFairVRFFixture
      );

      const maxUint64 = BigInt("18446744073709551615"); // 2^64 - 1
      const maxUint32 = 4294967295; // 2^32 - 1
      const maxUint16 = 65535; // 2^16 - 1

      await fairVRF.write.requestRandomWords(
        [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          maxUint64,
          maxUint16,
          maxUint32,
          maxUint32,
        ],
        { account: user.account }
      );

      const events = await fairVRF.getEvents.RandomWordsRequested();
      expect(events.length).to.equal(1);
    });
  });
});
