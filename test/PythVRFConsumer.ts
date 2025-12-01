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
async function deployLotteryFixture() {
  const [owner, fulfiller, user1, user2, user3] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  // Deploy FairVRF coordinator
  const fairVRF = await viem.deployContract("FairVRF", [
    fulfiller.account.address,
  ]);
  await fairVRF.write.setAnchor([s0]);

  // Deploy LotteryGame consumer
  const lotteryGame = await viem.deployContract("LotteryGame", [fairVRF.address]);

  return { fairVRF, lotteryGame, owner, fulfiller, user1, user2, user3, publicClient };
}

describe("PythVRFConsumer", () => {
  describe("LotteryGame Contract", () => {
    it("Should deploy with correct coordinator", async () => {
      const { lotteryGame, fairVRF } = await networkHelpers.loadFixture(
        deployLotteryFixture
      );

      const coordinator = await lotteryGame.read.COORDINATOR();
      expect(coordinator.toLowerCase()).to.equal(fairVRF.address.toLowerCase());
    });

    it("Should create a new lottery", async () => {
      const { lotteryGame, owner, publicClient } = await networkHelpers.loadFixture(
        deployLotteryFixture
      );

      const ticketPrice = BigInt("100000000000000000"); // 0.1 ETH

      const tx = await lotteryGame.write.createLottery([ticketPrice], {
        account: owner.account,
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });

      const events = await lotteryGame.getEvents.LotteryCreated();
      expect(events.length).to.equal(1);
      expect(events[0].args.lotteryId).to.equal(1n);
      expect(events[0].args.ticketPrice).to.equal(ticketPrice);
    });

    it("Should revert if ticket price is zero", async () => {
      const { lotteryGame, owner } = await networkHelpers.loadFixture(
        deployLotteryFixture
      );

      await viem.assertions.revertWith(
        lotteryGame.write.createLottery([0n], {
          account: owner.account,
        }),
        "Ticket price must be > 0"
      );
    });

    it("Should allow users to buy tickets", async () => {
      const { lotteryGame, owner, user1, publicClient } = await networkHelpers.loadFixture(
        deployLotteryFixture
      );

      const ticketPrice = BigInt("100000000000000000"); // 0.1 ETH

      // Create lottery
      await lotteryGame.write.createLottery([ticketPrice], {
        account: owner.account,
      });

      // Buy ticket
      const tx = await lotteryGame.write.buyTicket({
        account: user1.account,
        value: ticketPrice,
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });

      const events = await lotteryGame.getEvents.TicketPurchased();
      expect(events.length).to.equal(1);
      expect(events[0].args.lotteryId).to.equal(1n);
      expect(events[0].args.player!.toLowerCase()).to.equal(
        user1.account.address.toLowerCase()
      );
    });

    it("Should revert buying ticket with wrong price", async () => {
      const { lotteryGame, owner, user1 } = await networkHelpers.loadFixture(
        deployLotteryFixture
      );

      const ticketPrice = BigInt("100000000000000000"); // 0.1 ETH

      // Create lottery
      await lotteryGame.write.createLottery([ticketPrice], {
        account: owner.account,
      });

      // Try to buy with wrong amount
      await viem.assertions.revertWith(
        lotteryGame.write.buyTicket({
          account: user1.account,
          value: BigInt("50000000000000000"), // 0.05 ETH (wrong amount)
        }),
        "Incorrect ticket price"
      );
    });

    it("Should revert buying ticket when no active lottery", async () => {
      const { lotteryGame, user1 } = await networkHelpers.loadFixture(
        deployLotteryFixture
      );

      await viem.assertions.revertWith(
        lotteryGame.write.buyTicket({
          account: user1.account,
          value: BigInt("100000000000000000"),
        }),
        "No active lottery"
      );
    });

    it("Should allow drawing winner after tickets are bought", async () => {
      const { lotteryGame, owner, user1, user2, publicClient } = await networkHelpers.loadFixture(
        deployLotteryFixture
      );

      const ticketPrice = BigInt("100000000000000000"); // 0.1 ETH

      // Create lottery
      await lotteryGame.write.createLottery([ticketPrice], {
        account: owner.account,
      });

      // Buy tickets
      await lotteryGame.write.buyTicket({
        account: user1.account,
        value: ticketPrice,
      });

      await lotteryGame.write.buyTicket({
        account: user2.account,
        value: ticketPrice,
      });

      // Draw winner
      const tx = await lotteryGame.write.drawWinner({
        account: owner.account,
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });

      const events = await lotteryGame.getEvents.RandomnessRequested();
      expect(events.length).to.equal(1);
      expect(events[0].args.lotteryId).to.equal(1n);
    });

    it("Should revert drawing winner with no players", async () => {
      const { lotteryGame, owner } = await networkHelpers.loadFixture(
        deployLotteryFixture
      );

      const ticketPrice = BigInt("100000000000000000"); // 0.1 ETH

      // Create lottery
      await lotteryGame.write.createLottery([ticketPrice], {
        account: owner.account,
      });

      // Try to draw winner with no players
      await viem.assertions.revertWith(
        lotteryGame.write.drawWinner({
          account: owner.account,
        }),
        "No players"
      );
    });

    it("Should fulfill lottery and select winner", async () => {
      const { fairVRF, lotteryGame, owner, user1, user2, fulfiller, publicClient } = 
        await networkHelpers.loadFixture(deployLotteryFixture);

      const ticketPrice = BigInt("100000000000000000"); // 0.1 ETH

      // Create lottery
      await lotteryGame.write.createLottery([ticketPrice], {
        account: owner.account,
      });

      // Buy tickets
      await lotteryGame.write.buyTicket({
        account: user1.account,
        value: ticketPrice,
      });

      await lotteryGame.write.buyTicket({
        account: user2.account,
        value: ticketPrice,
      });

      // Draw winner
      await lotteryGame.write.drawWinner({
        account: owner.account,
      });

      // Fulfill randomness
      const tx = await fairVRF.write.fulfillRandomness([1n, s1], {
        account: fulfiller.account,
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });

      // Check winner selected event
      const events = await lotteryGame.getEvents.WinnerSelected();
      expect(events.length).to.equal(1);
      expect(events[0].args.lotteryId).to.equal(1n);
      expect(events[0].args.prize).to.equal(ticketPrice * 2n); // Total prize pool
      
      // Winner should be either user1 or user2
      const winner = events[0].args.winner!.toLowerCase();
      const validWinners = [user1.account.address.toLowerCase(), user2.account.address.toLowerCase()];
      expect(validWinners).to.include(winner);
    });

    it("Should return correct lottery details", async () => {
      const { lotteryGame, owner, user1, user2 } = await networkHelpers.loadFixture(
        deployLotteryFixture
      );

      const ticketPrice = BigInt("100000000000000000"); // 0.1 ETH

      // Create lottery
      await lotteryGame.write.createLottery([ticketPrice], {
        account: owner.account,
      });

      // Buy tickets
      await lotteryGame.write.buyTicket({
        account: user1.account,
        value: ticketPrice,
      });

      await lotteryGame.write.buyTicket({
        account: user2.account,
        value: ticketPrice,
      });

      const [players, prizePool, price, active, winner] = await lotteryGame.read.getLottery([1n]);
      
      expect(players.length).to.equal(2);
      expect(prizePool).to.equal(ticketPrice * 2n);
      expect(price).to.equal(ticketPrice);
      expect(active).to.equal(true);
      expect(winner).to.equal("0x0000000000000000000000000000000000000000");
    });

    it("Should return current lottery details", async () => {
      const { lotteryGame, owner, user1 } = await networkHelpers.loadFixture(
        deployLotteryFixture
      );

      const ticketPrice = BigInt("100000000000000000"); // 0.1 ETH

      // Create lottery
      await lotteryGame.write.createLottery([ticketPrice], {
        account: owner.account,
      });

      // Buy ticket
      await lotteryGame.write.buyTicket({
        account: user1.account,
        value: ticketPrice,
      });

      const [lotteryId, players, prizePool, price, active] = await lotteryGame.read.getCurrentLottery();
      
      expect(lotteryId).to.equal(1n);
      expect(players.length).to.equal(1);
      expect(prizePool).to.equal(ticketPrice);
      expect(price).to.equal(ticketPrice);
      expect(active).to.equal(true);
    });

    it("Should return correct player count", async () => {
      const { lotteryGame, owner, user1, user2, user3 } = await networkHelpers.loadFixture(
        deployLotteryFixture
      );

      const ticketPrice = BigInt("100000000000000000"); // 0.1 ETH

      // Create lottery
      await lotteryGame.write.createLottery([ticketPrice], {
        account: owner.account,
      });

      // Initially no players
      let playerCount = await lotteryGame.read.getPlayerCount();
      expect(playerCount).to.equal(0n);

      // Buy tickets
      await lotteryGame.write.buyTicket({
        account: user1.account,
        value: ticketPrice,
      });

      playerCount = await lotteryGame.read.getPlayerCount();
      expect(playerCount).to.equal(1n);

      await lotteryGame.write.buyTicket({
        account: user2.account,
        value: ticketPrice,
      });

      await lotteryGame.write.buyTicket({
        account: user3.account,
        value: ticketPrice,
      });

      playerCount = await lotteryGame.read.getPlayerCount();
      expect(playerCount).to.equal(3n);
    });

    it("Should only allow coordinator to call entropyCallback", async () => {
      const { lotteryGame, user1 } = await networkHelpers.loadFixture(
        deployLotteryFixture
      );

      await viem.assertions.revertWithCustomError(
        lotteryGame.write.entropyCallback([
          1n, 
          user1.account.address, 
          "0x1234567890123456789012345678901234567890123456789012345678901234"
        ], {
          account: user1.account,
        }),
        lotteryGame,
        "OnlyCoordinatorCanFulfill"
      );
    });
  });

  describe("Base PythVRF Consumer Functionality", () => {
    it("Should correctly identify coordinator", async () => {
      const { lotteryGame, fairVRF } = await networkHelpers.loadFixture(
        deployLotteryFixture
      );

      const coordinator = await lotteryGame.read.COORDINATOR();
      expect((coordinator as string).toLowerCase()).to.equal(fairVRF.address.toLowerCase());
    });

    it("Should handle Pyth-style requests correctly", async () => {
      const { fairVRF, user1, publicClient } = await networkHelpers.loadFixture(
        deployLotteryFixture
      );

      // Make Pyth-style request
      const tx = await fairVRF.write.requestWithCallback([
        fairVRF.address,
        "0x1234567890123456789012345678901234567890123456789012345678901234"
      ], {
        account: user1.account,
      });

      await publicClient.waitForTransactionReceipt({ hash: tx });

      const events = await fairVRF.getEvents.RandomWordsRequested();
      expect(events.length).to.equal(1);
      expect(events[0].args.requestId).to.equal(1n);
    });
  });
});
