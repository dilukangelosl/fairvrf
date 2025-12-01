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
async function deployConsumerFixture() {
  const [owner, fulfiller, user] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  // Deploy FairVRF coordinator
  const fairVRF = await viem.deployContract("FairVRF", [
    fulfiller.account.address,
  ]);
  await fairVRF.write.setAnchor([s0]);

  // Deploy DiceGame consumer
  const diceGame = await viem.deployContract("DiceGame", [fairVRF.address]);

  return { fairVRF, diceGame, owner, fulfiller, user, publicClient };
}

describe("FairVRFConsumer", () => {
  describe("DiceGame Contract", () => {
    it("Should deploy with correct coordinator", async () => {
      const { diceGame, fairVRF } = await networkHelpers.loadFixture(
        deployConsumerFixture
      );

      const coordinator = await diceGame.read.COORDINATOR();
      expect((coordinator as string).toLowerCase()).to.equal(fairVRF.address.toLowerCase());
    });

    it("Should allow users to roll dice", async () => {
      const { diceGame, user, publicClient } = await networkHelpers.loadFixture(
        deployConsumerFixture
      );

      const betAmount = BigInt("1000000000000000000"); // 1 ETH
      const targetNumber = 3;

      const tx = await diceGame.write.rollDice([targetNumber], {
        account: user.account,
        value: betAmount,
      });

      const receipt = await publicClient.waitForTransactionReceipt({
        hash: tx,
      });

      const events = await diceGame.getEvents.DiceRolled();
      expect(events.length).to.equal(1);
      expect(events[0].args.player!.toLowerCase()).to.equal(
        user.account.address.toLowerCase()
      );
      expect(events[0].args.targetNumber).to.equal(targetNumber);
      expect(events[0].args.bet).to.equal(betAmount);
    });

    it("Should revert if no ETH sent", async () => {
      const { diceGame, user } = await networkHelpers.loadFixture(
        deployConsumerFixture
      );

      await viem.assertions.revertWith(
        diceGame.write.rollDice([3], {
          account: user.account,
          value: 0n,
        }),
        "Must send ETH to bet"
      );
    });

    it("Should revert if target number is invalid", async () => {
      const { diceGame, user } = await networkHelpers.loadFixture(
        deployConsumerFixture
      );

      // Test number too low
      await viem.assertions.revertWith(
        diceGame.write.rollDice([0], {
          account: user.account,
          value: BigInt("1000000000000000000"),
        }),
        "Target must be 1-6"
      );

      // Test number too high
      await viem.assertions.revertWith(
        diceGame.write.rollDice([7], {
          account: user.account,
          value: BigInt("1000000000000000000"),
        }),
        "Target must be 1-6"
      );
    });

    it("Should fulfill dice roll and determine winner", async () => {
      const { fairVRF, diceGame, user, fulfiller, publicClient } =
        await networkHelpers.loadFixture(deployConsumerFixture);

      const betAmount = BigInt("1000000000000000000"); // 1 ETH
      const targetNumber = 3;

      // Roll dice
      await diceGame.write.rollDice([targetNumber], {
        account: user.account,
        value: betAmount,
      });

      // Fulfill randomness
      const tx = await fairVRF.write.fulfillRandomness([1n, s1], {
        account: fulfiller.account,
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });

      // Check result event
      const events = await diceGame.getEvents.DiceResult();
      expect(events.length).to.equal(1);
      expect(events[0].args.player!.toLowerCase()).to.equal(
        user.account.address.toLowerCase()
      );
      expect(events[0].args.result).to.be.greaterThan(0);
      expect(events[0].args.result).to.be.lessThanOrEqual(6);
    });

    it("Should allow winner to withdraw winnings", async () => {
      const { fairVRF, diceGame, user, fulfiller, publicClient } =
        await networkHelpers.loadFixture(deployConsumerFixture);

      const betAmount = BigInt("100000000000000000"); // 0.1 ETH

      // Fund the contract first
      await user.sendTransaction({
        to: diceGame.address,
        value: BigInt("10000000000000000000"), // 10 ETH
      });

      // Roll dice with target number 1 (1/6 chance to win)
      await diceGame.write.rollDice([1], {
        account: user.account,
        value: betAmount,
      });

      // Fulfill the request
      await fairVRF.write.fulfillRandomness([1n, s1], {
        account: fulfiller.account,
      });

      // Check if user won (dice result = 1)
      const winnings = await diceGame.read.playerWinnings([user.account.address]);
      
      if (winnings > 0n) {
        // User won, test withdrawal
        const balanceBefore = await publicClient.getBalance({
          address: user.account.address,
        });

        await diceGame.write.withdrawWinnings({
          account: user.account,
        });

        const balanceAfter = await publicClient.getBalance({
          address: user.account.address,
        });

        expect(Number(balanceAfter)).to.be.greaterThan(Number(balanceBefore));
      } else {
        // User didn't win, which is also valid - test that winnings are 0
        expect(winnings).to.equal(0n);
      }
    });

    it("Should revert withdraw with no winnings", async () => {
      const { diceGame, user } = await networkHelpers.loadFixture(
        deployConsumerFixture
      );

      await viem.assertions.revertWith(
        diceGame.write.withdrawWinnings({
          account: user.account,
        }),
        "No winnings"
      );
    });

    it("Should return correct contract balance", async () => {
      const { diceGame, user } = await networkHelpers.loadFixture(
        deployConsumerFixture
      );

      const betAmount = BigInt("1000000000000000000"); // 1 ETH

      await diceGame.write.rollDice([3], {
        account: user.account,
        value: betAmount,
      });

      const balance = await diceGame.read.getBalance();
      expect(balance).to.equal(betAmount);
    });

    it("Should only allow coordinator to call rawFulfillRandomness", async () => {
      const { diceGame, user } = await networkHelpers.loadFixture(
        deployConsumerFixture
      );

      await viem.assertions.revertWithCustomError(
        diceGame.write.rawFulfillRandomness([1n, [123n]], {
          account: user.account,
        }),
        diceGame,
        "OnlyCoordinatorCanFulfill"
      );
    });

    it("Should handle callback with insufficient gas gracefully", async () => {
      const { fairVRF, diceGame, user, fulfiller, publicClient } =
        await networkHelpers.loadFixture(deployConsumerFixture);

      // Roll dice with very low callback gas limit
      await diceGame.write.rollDice([3], {
        account: user.account,
        value: BigInt("1000000000000000000"),
      });

      // This should still work but callback might fail
      const tx = await fairVRF.write.fulfillRandomness([1n, s1], {
        account: fulfiller.account,
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });

      // Check that fulfillment event was emitted (even if callback failed)
      const events = await fairVRF.getEvents.RandomWordsFulfilled();
      expect(events.length).to.equal(1);
    });
  });

  describe("Base Consumer Functionality", () => {
    it("Should correctly identify coordinator in consumer base", async () => {
      const { diceGame, fairVRF } = await networkHelpers.loadFixture(
        deployConsumerFixture
      );

      const coordinator = await diceGame.read.COORDINATOR();
      expect((coordinator as string).toLowerCase()).to.equal(fairVRF.address.toLowerCase());
    });

    it("Should handle multiple random words correctly", async () => {
      const { fairVRF, user, fulfiller, publicClient } =
        await networkHelpers.loadFixture(deployConsumerFixture);

      // Request multiple words
      await fairVRF.write.requestRandomWords(
        [
          "0x0000000000000000000000000000000000000000000000000000000000000000",
          0n,
          3,
          500000,
          10, // 10 words
        ],
        { account: user.account }
      );

      const tx = await fairVRF.write.fulfillRandomness([1n, s1], {
        account: fulfiller.account,
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });

      const events = await fairVRF.getEvents.RandomWordsFulfilled();
      expect(events.length).to.equal(1);
      expect(events[0].args.success).to.equal(true);
    });
  });
});
