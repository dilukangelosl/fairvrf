// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/**
 * @title PythVRFConsumer
 * @notice Abstract contract for Pyth Entropy style VRF consumption.
 * @dev Compatible with FairVRF's Pyth-style interface.
 * @author dev angelo (https://x.com/cryptoangelodev)
 */
abstract contract PythVRFConsumer {
    error OnlyCoordinatorCanFulfill(address have, address want);

    address public immutable COORDINATOR;

    /**
     * @param _coordinator The address of the FairVRF coordinator contract
     */
    constructor(address _coordinator) {
        COORDINATOR = _coordinator;
    }

    /**
     * @notice Fulfill entropy callback handler
     * @param sequenceNumber The sequence number of the request being fulfilled
     * @param provider The provider address (should be COORDINATOR)
     * @param randomNumber The random value generated
     */
    function entropyCallback(
        uint64 sequenceNumber, 
        address provider, 
        bytes32 randomNumber
    ) external {
        if (msg.sender != COORDINATOR) {
            revert OnlyCoordinatorCanFulfill(msg.sender, COORDINATOR);
        }
        fulfillEntropy(sequenceNumber, provider, randomNumber);
    }

    /**
     * @notice Callback function to be implemented by the consuming contract
     * @param sequenceNumber The sequence number of the request being fulfilled
     * @param provider The provider address
     * @param randomNumber The random value generated
     */
    function fulfillEntropy(
        uint64 sequenceNumber, 
        address provider, 
        bytes32 randomNumber
    ) internal virtual;
}
