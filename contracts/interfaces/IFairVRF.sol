// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

/**
 * @title IFairVRF
 * @dev Interface for FairVRF coordinator
 */
interface IFairVRF {
    function requestRandomWords(
        bytes32 keyHash,
        uint64 subId,
        uint16 requestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords
    ) external returns (uint256 requestId);
    
    function fulfillRandomness(
        uint256 requestId,
        bytes32 nextServerSeed
    ) external;
    
    function currentAnchor() external view returns (bytes32);
}
