// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title FairVRFConsumer
 * @notice Abstract contract to make using FairVRF simple.
 * @dev Similar to Chainlink's VRFConsumerBaseV2 for easy migration.
 * @author dev angelo (https://x.com/cryptoangelodev)
 */
abstract contract FairVRFConsumer {
    error OnlyCoordinatorCanFulfill(address have, address want);

    address public immutable COORDINATOR;

    /**
     * @param _coordinator The address of the FairVRF coordinator contract
     */
    constructor(address _coordinator) {
        COORDINATOR = _coordinator;
    }

    /**
     * @notice Fulfill randomness handler
     * @param requestId The ID of the request being fulfilled
     * @param randomWords The random values generated
     */
    function rawFulfillRandomness(uint256 requestId, uint256[] memory randomWords) external {
        if (msg.sender != COORDINATOR) {
            revert OnlyCoordinatorCanFulfill(msg.sender, COORDINATOR);
        }
        fulfillRandomWords(requestId, randomWords);
    }

    /**
     * @notice Callback function to be implemented by the consuming contract
     * @param requestId The ID of the request being fulfilled
     * @param randomWords The random values generated
     */
    function fulfillRandomWords(uint256 requestId, uint256[] memory randomWords) internal virtual;
}
