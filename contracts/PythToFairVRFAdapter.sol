// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "./interfaces/IFairVRF.sol";
import "./FairVRFConsumer.sol";

/**
 * @dev Pyth Entropy V2 interface (standalone to avoid external dependencies)
 */
interface IEntropyV2 {
    function requestV2(uint32 callbackGasLimit) external payable returns (uint64);
    function getFeeV2(uint32 callbackGasLimit) external view returns (uint256);
}

/**
 * @dev Interface for Entropy consumers (from Pyth SDK)
 */
interface IEntropyConsumer {
    function entropyCallback(
        uint64 sequenceNumber,
        address provider,
        bytes32 randomValue
    ) external;
}

/**
 * @title PythToFairVRFAdapter
 * @dev Adapter that makes FairVRF compatible with Pyth Entropy V2 interface
 * This allows existing Pyth-based contracts to use FairVRF with ZERO code changes
 * Just deploy this adapter and point your contract to this address instead of Pyth
 */
contract PythToFairVRFAdapter is IEntropyV2, FairVRFConsumer {
    
    // State variables
    mapping(uint256 => uint64) public fairVRFToSequence; // FairVRF requestId => Pyth sequenceNumber
    mapping(uint64 => uint256) public sequenceToFairVRF; // Pyth sequenceNumber => FairVRF requestId
    mapping(uint64 => address) public sequenceToConsumer; // sequenceNumber => consumer contract
    mapping(uint64 => uint32) public sequenceToGasLimit; // sequenceNumber => callback gas limit
    
    uint64 private nextSequenceNumber = 1;
    uint32 private constant DEFAULT_GAS_LIMIT = 500000;

    // Events matching Pyth interface
    event RandomnessRequested(uint64 indexed sequenceNumber, address indexed consumer);

    constructor(address _fairVRFCoordinator) FairVRFConsumer(_fairVRFCoordinator) {}

    /**
     * @dev Pyth Entropy V2 requestV2 function - adapted to use FairVRF
     * @param callbackGasLimit Gas limit for the callback
     * @return sequenceNumber Unique sequence number for this request
     */
    function requestV2(uint32 callbackGasLimit) external payable override returns (uint64) {
        // Generate sequence number for Pyth compatibility
        uint64 sequenceNumber = nextSequenceNumber++;
        
        // Store consumer info
        sequenceToConsumer[sequenceNumber] = msg.sender;
        sequenceToGasLimit[sequenceNumber] = callbackGasLimit;
        
        // Make FairVRF request (NO FEES!)
        uint256 fairVRFRequestId = IFairVRF(COORDINATOR).requestRandomWords(
            bytes32(0), // keyHash (ignored by FairVRF)
            0,          // subId (ignored by FairVRF)  
            3,          // confirmations
            callbackGasLimit,
            1           // number of words
        );
        
        // Map the request IDs
        fairVRFToSequence[fairVRFRequestId] = sequenceNumber;
        sequenceToFairVRF[sequenceNumber] = fairVRFRequestId;
        
        // Refund any ETH sent (FairVRF is free!)
        if (msg.value > 0) {
            (bool success, ) = msg.sender.call{value: msg.value}("");
            require(success, "Refund failed");
        }
        
        emit RandomnessRequested(sequenceNumber, msg.sender);
        return sequenceNumber;
    }

    /**
     * @dev FairVRF callback - converts to Pyth format and forwards to consumer
     */
    function fulfillRandomWords(
        uint256 requestId,
        uint256[] memory randomWords
    ) internal override {
        uint64 sequenceNumber = fairVRFToSequence[requestId];
        address consumer = sequenceToConsumer[sequenceNumber];
        uint32 gasLimit = sequenceToGasLimit[sequenceNumber];
        
        require(consumer != address(0), "Invalid sequence number");
        
        // For direct requests (consumer is msg.sender), we don't need to call back
        // For contract consumers, call their entropyCallback
        if (consumer.code.length > 0) {
            // Call the consumer's entropyCallback with Pyth interface
            try IEntropyConsumer(consumer).entropyCallback{gas: gasLimit}(
                sequenceNumber,
                address(this), // provider address (this adapter)
                bytes32(randomWords[0])
            ) {
                // Success - clean up
            } catch {
                // Handle callback failure gracefully
                // Could emit an event or implement retry logic
            }
        }
        
        // Clean up mappings
        delete fairVRFToSequence[requestId];
        delete sequenceToFairVRF[sequenceNumber];
        delete sequenceToConsumer[sequenceNumber];
        delete sequenceToGasLimit[sequenceNumber];
    }

    /**
     * @dev Pyth Entropy V2 getFeeV2 function - returns 0 since FairVRF is free
     * @param callbackGasLimit Gas limit (ignored)
     * @return Always returns 0 (FairVRF has no fees!)
     */
    function getFeeV2(uint32 callbackGasLimit) external pure override returns (uint256) {
        callbackGasLimit; // Silence unused parameter warning
        return 0; // FairVRF is completely free!
    }

    /**
     * @dev Emergency function to withdraw any accidentally sent ETH
     */
    function withdraw() external {
        require(msg.sender == owner(), "Only owner");
        (bool success, ) = owner().call{value: address(this).balance}("");
        require(success, "Withdrawal failed");
    }

    /**
     * @dev Get the owner (for withdraw function)
     */
    function owner() public pure returns (address) {
        // You can implement proper ownership or use OpenZeppelin's Ownable
        // For now, return zero address to disable withdraw
        return address(0); // TODO: Implement proper ownership
    }

    /**
     * @dev Receive function to handle accidental ETH transfers
     */
    receive() external payable {
        // Accept ETH and refund immediately since FairVRF is free
        if (msg.value > 0) {
            (bool success, ) = msg.sender.call{value: msg.value}("");
            require(success, "Refund failed");
        }
    }
}
