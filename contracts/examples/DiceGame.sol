// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import "../FairVRFConsumer.sol";

interface IFairVRF {
    function requestRandomWords(
        bytes32 keyHash,
        uint64 subId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords
    ) external returns (uint256 requestId);
}

/**
 * @title DiceGame
 * @notice Example game using FairVRF with Chainlink-style interface
 * @dev Demonstrates how to migrate from Chainlink VRF to FairVRF
 */
contract DiceGame is FairVRFConsumer {
    struct Roll {
        address player;
        uint256 bet;
        uint8 targetNumber;
        bool fulfilled;
        uint8 result;
        bool won;
    }

    IFairVRF public immutable vrfCoordinator;
    mapping(uint256 => Roll) public rolls;
    mapping(address => uint256) public playerWinnings;

    event DiceRolled(uint256 indexed requestId, address indexed player, uint8 targetNumber, uint256 bet);
    event DiceResult(uint256 indexed requestId, address indexed player, uint8 result, bool won, uint256 payout);

    constructor(address _vrfCoordinator) FairVRFConsumer(_vrfCoordinator) {
        vrfCoordinator = IFairVRF(_vrfCoordinator);
    }

    /**
     * @notice Roll dice and bet on a number (1-6)
     * @param targetNumber The number to bet on (1-6)
     */
    function rollDice(uint8 targetNumber) external payable returns (uint256 requestId) {
        require(msg.value > 0, "Must send ETH to bet");
        require(targetNumber >= 1 && targetNumber <= 6, "Target must be 1-6");

        // Request randomness from FairVRF
        requestId = vrfCoordinator.requestRandomWords(
            bytes32(0), // keyHash (ignored in FairVRF)
            0,          // subId (ignored in FairVRF)
            3,          // requestConfirmations
            100000,     // callbackGasLimit
            1           // numWords
        );

        rolls[requestId] = Roll({
            player: msg.sender,
            bet: msg.value,
            targetNumber: targetNumber,
            fulfilled: false,
            result: 0,
            won: false
        });

        emit DiceRolled(requestId, msg.sender, targetNumber, msg.value);
    }

    /**
     * @notice Callback function called by FairVRF
     * @param requestId The request ID
     * @param randomWords Array of random numbers
     */
    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal override {
        Roll storage roll = rolls[requestId];
        require(!roll.fulfilled, "Roll already fulfilled");
        require(roll.player != address(0), "Roll does not exist");

        // Convert random number to dice result (1-6)
        uint8 diceResult = uint8((randomWords[0] % 6) + 1);
        
        roll.result = diceResult;
        roll.fulfilled = true;
        
        // Check if player won
        if (diceResult == roll.targetNumber) {
            roll.won = true;
            uint256 payout = roll.bet * 6; // 6x payout for correct guess
            playerWinnings[roll.player] += payout;
        }

        emit DiceResult(requestId, roll.player, diceResult, roll.won, roll.won ? roll.bet * 6 : 0);
    }

    /**
     * @notice Withdraw winnings
     */
    function withdrawWinnings() external {
        uint256 winnings = playerWinnings[msg.sender];
        require(winnings > 0, "No winnings");
        
        playerWinnings[msg.sender] = 0;
        payable(msg.sender).transfer(winnings);
    }

    /**
     * @notice Get contract balance
     */
    function getBalance() external view returns (uint256) {
        return address(this).balance;
    }

    /**
     * @notice Allow contract to receive ETH for funding prizes
     */
    receive() external payable {
        // Contract can receive ETH for prize pool funding
    }
}
