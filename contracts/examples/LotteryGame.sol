// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../PythVRFConsumer.sol";

interface IFairVRFPyth {
    function requestWithCallback(
        address provider,
        bytes32 userRandomNumber
    ) external payable returns (uint64 sequenceNumber);
}

/**
 * @title LotteryGame
 * @notice Example lottery using FairVRF with Pyth Entropy style interface
 * @dev Demonstrates Pyth-compatible randomness consumption
 */
contract LotteryGame is PythVRFConsumer {
    struct Lottery {
        address[] players;
        uint256 prizePool;
        uint256 ticketPrice;
        bool active;
        address winner;
        bytes32 winningNumber;
        uint64 requestId;
    }

    IFairVRFPyth public immutable vrfCoordinator;
    
    uint256 public currentLotteryId;
    mapping(uint256 => Lottery) public lotteries;
    mapping(uint64 => uint256) public requestToLottery;

    event LotteryCreated(uint256 indexed lotteryId, uint256 ticketPrice);
    event TicketPurchased(uint256 indexed lotteryId, address indexed player);
    event RandomnessRequested(uint256 indexed lotteryId, uint64 requestId);
    event WinnerSelected(uint256 indexed lotteryId, address indexed winner, uint256 prize);

    constructor(address _vrfCoordinator) PythVRFConsumer(_vrfCoordinator) {
        vrfCoordinator = IFairVRFPyth(_vrfCoordinator);
    }

    /**
     * @notice Create a new lottery
     * @param ticketPrice Price per ticket in wei
     */
    function createLottery(uint256 ticketPrice) external {
        require(ticketPrice > 0, "Ticket price must be > 0");
        
        currentLotteryId++;
        lotteries[currentLotteryId] = Lottery({
            players: new address[](0),
            prizePool: 0,
            ticketPrice: ticketPrice,
            active: true,
            winner: address(0),
            winningNumber: bytes32(0),
            requestId: 0
        });

        emit LotteryCreated(currentLotteryId, ticketPrice);
    }

    /**
     * @notice Buy a ticket for the current lottery
     */
    function buyTicket() external payable {
        Lottery storage lottery = lotteries[currentLotteryId];
        require(lottery.active, "No active lottery");
        require(msg.value == lottery.ticketPrice, "Incorrect ticket price");

        lottery.players.push(msg.sender);
        lottery.prizePool += msg.value;

        emit TicketPurchased(currentLotteryId, msg.sender);
    }

    /**
     * @notice Draw the winner for current lottery
     */
    function drawWinner() external {
        Lottery storage lottery = lotteries[currentLotteryId];
        require(lottery.active, "No active lottery");
        require(lottery.players.length > 0, "No players");

        // Generate user entropy from current state
        bytes32 userEntropy = keccak256(abi.encode(
            block.timestamp,
            block.difficulty,
            currentLotteryId,
            lottery.players.length
        ));

        // Request randomness using Pyth-style interface
        uint64 sequenceNumber = vrfCoordinator.requestWithCallback(
            address(this), // provider
            userEntropy     // user random number
        );

        lottery.requestId = sequenceNumber;
        requestToLottery[sequenceNumber] = currentLotteryId;
        lottery.active = false;

        emit RandomnessRequested(currentLotteryId, sequenceNumber);
    }

    /**
     * @notice Callback function called by FairVRF (Pyth style)
     * @param sequenceNumber The sequence number of the request
     * @param provider The provider address
     * @param randomNumber The random number generated
     */
    function fulfillEntropy(
        uint64 sequenceNumber,
        address provider,
        bytes32 randomNumber
    ) internal override {
        uint256 lotteryId = requestToLottery[sequenceNumber];
        require(lotteryId != 0, "Invalid request");

        Lottery storage lottery = lotteries[lotteryId];
        require(!lottery.active, "Lottery still active");
        require(lottery.winner == address(0), "Winner already selected");

        // Select winner based on random number
        uint256 winnerIndex = uint256(randomNumber) % lottery.players.length;
        address winner = lottery.players[winnerIndex];

        lottery.winner = winner;
        lottery.winningNumber = randomNumber;

        // Transfer prize to winner
        uint256 prize = lottery.prizePool;
        payable(winner).transfer(prize);

        emit WinnerSelected(lotteryId, winner, prize);
    }

    /**
     * @notice Get lottery details
     * @param lotteryId The lottery ID
     */
    function getLottery(uint256 lotteryId) external view returns (
        address[] memory players,
        uint256 prizePool,
        uint256 ticketPrice,
        bool active,
        address winner
    ) {
        Lottery memory lottery = lotteries[lotteryId];
        return (
            lottery.players,
            lottery.prizePool,
            lottery.ticketPrice,
            lottery.active,
            lottery.winner
        );
    }

    /**
     * @notice Get current lottery details
     */
    function getCurrentLottery() external view returns (
        uint256 lotteryId,
        address[] memory players,
        uint256 prizePool,
        uint256 ticketPrice,
        bool active
    ) {
        Lottery memory lottery = lotteries[currentLotteryId];
        return (
            currentLotteryId,
            lottery.players,
            lottery.prizePool,
            lottery.ticketPrice,
            lottery.active
        );
    }

    /**
     * @notice Get player count for current lottery
     */
    function getPlayerCount() external view returns (uint256) {
        return lotteries[currentLotteryId].players.length;
    }
}
