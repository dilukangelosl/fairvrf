// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @dev Pyth Entropy V2 interface
 */
interface IEntropyV2 {
    function requestV2(uint32 callbackGasLimit) external payable returns (uint64);
    function getFeeV2(uint32 callbackGasLimit) external view returns (uint256);
}

/**
 * @dev Interface for Entropy consumers
 */
interface IEntropyConsumer {
    function entropyCallback(
        uint64 sequenceNumber,
        address provider,
        bytes32 randomValue
    ) external;
    
    function getEntropy() external view returns (address);
}

/**
 * @title PythExampleConsumer
 * @dev Simple contract to test Pyth functionality via FairVRF Adapter
 */
contract PythExampleConsumer is IEntropyConsumer, Ownable {
    
    IEntropyV2 public entropy;
    
    event RandomnessRequested(uint64 sequenceNumber, address user);
    event RandomnessReceived(uint64 sequenceNumber, bytes32 randomValue);

    // Store results
    mapping(uint64 => bytes32) public randomResults;
    mapping(uint64 => bool) public requestFulfilled;

    constructor(address _entropy) Ownable(msg.sender) {
        entropy = IEntropyV2(_entropy);
    }

    /**
     * @dev Request randomness
     */
    function requestRandomness() external payable {
        uint32 callbackGasLimit = 100000;
        
        uint256 fee = entropy.getFeeV2(callbackGasLimit);
        require(msg.value >= fee, "Insufficient fee");

        uint64 sequenceNumber = entropy.requestV2{value: fee}(callbackGasLimit);
        
        emit RandomnessRequested(sequenceNumber, msg.sender);
        
        // Refund excess
        if (msg.value > fee) {
            payable(msg.sender).transfer(msg.value - fee);
        }
    }

    /**
     * @dev Callback from Entropy provider
     */
    function entropyCallback(
        uint64 sequenceNumber,
        address provider,
        bytes32 randomValue
    ) external override {
        require(msg.sender == address(entropy), "Only entropy provider");
        
        randomResults[sequenceNumber] = randomValue;
        requestFulfilled[sequenceNumber] = true;
        
        emit RandomnessReceived(sequenceNumber, randomValue);
    }

    /**
     * @dev Required by IEntropyConsumer
     */
    function getEntropy() external view override returns (address) {
        return address(entropy);
    }
    
    /**
     * @dev Update entropy provider address
     */
    function setEntropy(address _entropy) external onlyOwner {
        entropy = IEntropyV2(_entropy);
    }
}
