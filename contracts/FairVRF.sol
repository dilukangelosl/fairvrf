// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";

/**
 * @title FairVRF
 * @notice A self-hosted, provably fair VRF (Verifiable Random Function) Coordinator.
 * @dev Acts as a drop-in replacement for Chainlink VRF V2. 
 * @author dev angelo (https://x.com/cryptoangelodev)
 * 
 * Architecture: Reverse Hash Chain (PayWord model)
 * 1. Server pre-generates a hash chain: s_n -> s_{n-1} -> ... -> s_0 (Anchor)
 * 2. s_0 is committed on-chain as `currentAnchor`.
 * 3. To fulfill a request, server reveals s_1. Contract checks keccak256(s_1) == s_0.
 * 4. If valid, `currentAnchor` becomes s_1, and mixed randomness is returned.
 * This proves the seed was pre-committed and not manipulated for the specific request.
 */
contract FairVRF is Ownable, ReentrancyGuard {
    // -------------------------------------------------------------------------
    // Errors
    // -------------------------------------------------------------------------
    error InvalidSeedProof();
    error RequestNotFound();
    error AlreadyFulfilled();
    error BlockHashNotAvailable();
    error OnlyFulfiller();
    error UnauthorizedConsumer();

    // -------------------------------------------------------------------------
    // Events
    // -------------------------------------------------------------------------
    event RandomWordsRequested(
        bytes32 indexed keyHash,
        uint256 requestId,
        uint256 preSeed,
        uint64 indexed subId,
        uint16 minimumRequestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords,
        address indexed sender
    );

    event RandomWordsFulfilled(
        uint256 indexed requestId,
        uint256 outputSeed,
        uint96 payment,
        bool success
    );

    event AnchorUpdated(bytes32 indexed oldAnchor, bytes32 indexed newAnchor);
    event ConsumerWhitelistUpdated(bool enabled);
    event ConsumerAuthorized(address indexed consumer, bool authorized);

    // -------------------------------------------------------------------------
    // State Variables
    // -------------------------------------------------------------------------
    enum RequestType { Chainlink, Pyth }

    struct Request {
        address sender;
        uint64 blockNumber;
        uint32 callbackGasLimit;
        uint32 numWords;
        bool fulfilled;
        bytes32 userSeed; // Hashed from request params to preserve context
        RequestType reqType;
    }

    uint256 public s_nextRequestId = 1;
    
    // The tip of the reverse hash chain. keccak256(next_revealed_seed) must equal this.
    bytes32 public currentAnchor;
    
    // The address authorized to submit fulfillments (separate from owner for security)
    address public fulfiller;

    // Consumer whitelist (if enabled, only whitelisted addresses can request randomness)
    mapping(address => bool) public authorizedConsumers;
    bool public consumerWhitelistEnabled;

    // Mapping from requestId to request details
    mapping(uint256 => Request) public s_requests;

    constructor(address _fulfiller) Ownable(msg.sender) {
        fulfiller = _fulfiller;
    }

    // -------------------------------------------------------------------------
    // Modifiers
    // -------------------------------------------------------------------------
    modifier onlyFulfiller() {
        if (msg.sender != fulfiller && msg.sender != owner()) revert OnlyFulfiller();
        _;
    }

    modifier onlyAuthorizedConsumer() {
        if (consumerWhitelistEnabled && !authorizedConsumers[msg.sender]) {
            revert UnauthorizedConsumer();
        }
        _;
    }

    // -------------------------------------------------------------------------
    // Admin Functions
    // -------------------------------------------------------------------------

    /**
     * @notice Sets the initial anchor or resets the chain.
     * @param _newAnchor The last hash of the new chain (e.g., s_0)
     */
    function setAnchor(bytes32 _newAnchor) external onlyOwner {
        bytes32 oldAnchor = currentAnchor;
        currentAnchor = _newAnchor;
        emit AnchorUpdated(oldAnchor, _newAnchor);
    }

    /**
     * @notice Updates the fulfiller address.
     * @param _newFulfiller Address of the off-chain bot wallet
     */
    function setFulfiller(address _newFulfiller) external onlyOwner {
        fulfiller = _newFulfiller;
    }

    /**
     * @notice Enable or disable consumer whitelist enforcement.
     * @param _enabled True to enable whitelist, false for open access
     */
    function setConsumerWhitelistEnabled(bool _enabled) external onlyOwner {
        consumerWhitelistEnabled = _enabled;
        emit ConsumerWhitelistUpdated(_enabled);
    }

    /**
     * @notice Authorize or deauthorize a consumer contract.
     * @param _consumer Address of the consumer contract
     * @param _authorized True to authorize, false to deauthorize
     */
    function setConsumerAuthorization(address _consumer, bool _authorized) external onlyOwner {
        authorizedConsumers[_consumer] = _authorized;
        emit ConsumerAuthorized(_consumer, _authorized);
    }

    /**
     * @notice Batch authorize multiple consumers.
     * @param _consumers Array of consumer addresses
     * @param _authorized Array of authorization flags (same length as _consumers)
     */
    function batchSetConsumerAuthorization(
        address[] calldata _consumers,
        bool[] calldata _authorized
    ) external onlyOwner {
        require(_consumers.length == _authorized.length, "Array length mismatch");
        
        for (uint256 i = 0; i < _consumers.length; i++) {
            authorizedConsumers[_consumers[i]] = _authorized[i];
            emit ConsumerAuthorized(_consumers[i], _authorized[i]);
        }
    }

    // -------------------------------------------------------------------------
    // User Functions
    // -------------------------------------------------------------------------

    /**
     * @notice Request random words. Matches Chainlink VRF V2 signature for compatibility.
     * @param keyHash ID of the public key against which randomness is generated (compatibility param)
     * @param subId Subscription ID (compatibility param)
     * @param minimumRequestConfirmations How many blocks you'd like to wait before responding
     * @param callbackGasLimit How much gas you'd like to receive in your fulfillRandomWords callback
     * @param numWords How many random words you'd like to receive
     * @return requestId The generated request ID
     */
    function requestRandomWords(
        bytes32 keyHash,
        uint64 subId,
        uint16 minimumRequestConfirmations,
        uint32 callbackGasLimit,
        uint32 numWords
    ) external nonReentrant onlyAuthorizedConsumer returns (uint256 requestId) {
        requestId = s_nextRequestId++;
        
        // Mixing request context into a userSeed.
        // This ensures even if two requests come in same block, they have unique context.
        bytes32 userSeed = keccak256(abi.encode(requestId, msg.sender, keyHash, subId));

        s_requests[requestId] = Request({
            sender: msg.sender,
            blockNumber: uint64(block.number),
            callbackGasLimit: callbackGasLimit,
            numWords: numWords,
            fulfilled: false,
            userSeed: userSeed,
            reqType: RequestType.Chainlink
        });

        emit RandomWordsRequested(
            keyHash,
            requestId,
            uint256(userSeed),
            subId,
            minimumRequestConfirmations,
            callbackGasLimit,
            numWords,
            msg.sender
        );

        return requestId;
    }

    /**
     * @notice Pyth Entropy Compatibility - Request randomness.
     * @param provider Ignored (this contract is the provider).
     * @param userRandomNumber User provided entropy.
     * @return sequenceNumber Unique request ID (same as Chainlink requestId).
     */
    function requestWithCallback(
        address provider,
        bytes32 userRandomNumber
    ) external payable nonReentrant onlyAuthorizedConsumer returns (uint64 sequenceNumber) {
        uint256 requestId = s_nextRequestId++;
        
        bytes32 userSeed = keccak256(abi.encode(requestId, msg.sender, userRandomNumber));

        // Default config logic. Pyth usually involves fee payment. 
        // For MVP self-hosted, we rely on sender checking.
        uint32 callbackGasLimit = 500000; 

        s_requests[requestId] = Request({
            sender: msg.sender,
            blockNumber: uint64(block.number),
            callbackGasLimit: callbackGasLimit,
            numWords: 1, // Pyth returns 1 seed usually
            fulfilled: false,
            userSeed: userSeed,
            reqType: RequestType.Pyth
        });

        // We emit the same event so the bot picks it up universally
        // Using 0 as keyHash/subId for Pyth flow
        emit RandomWordsRequested(
            bytes32(0),
            requestId,
            uint256(userSeed),
            0, // subId
            1, // confirmations
            callbackGasLimit,
            1, // numWords
            msg.sender
        );

        return uint64(requestId);
    }

    // -------------------------------------------------------------------------
    // Oracle Functions
    // -------------------------------------------------------------------------

    /**
     * @notice Fulfills a randomness request using the next link in the hash chain.
     * @param requestId The ID of the request to fulfill
     * @param nextServerSeed The pre-image of the current anchor (s_{i+1})
     */
    function fulfillRandomness(uint256 requestId, bytes32 nextServerSeed) external onlyFulfiller nonReentrant {
        Request storage req = s_requests[requestId];
        
        if (req.sender == address(0)) revert RequestNotFound();
        if (req.fulfilled) revert AlreadyFulfilled();

        // 1. Verify Hash Chain Proof
        // The revealed seed, when hashed, must equal the current committed anchor.
        if (keccak256(abi.encodePacked(nextServerSeed)) != currentAnchor) {
            revert InvalidSeedProof();
        }

        // 2. Update State - Move the chain forward
        // The revealed seed becomes the new anchor for the NEXT request.
        currentAnchor = nextServerSeed;
        req.fulfilled = true;

        // 3. Entropy Mixing
        // We use the blockhash of the request block to ensure the server couldn't predict 
        // the precise outcome when it committed the chain years ago.
        bytes32 bh = blockhash(req.blockNumber);
        if (bh == bytes32(0)) {
            // If blockhash is unavailable (older than 256 blocks), use fallback entropy
            // This prevents stuck requests while maintaining unpredictability
            bh = keccak256(abi.encodePacked(
                block.prevrandao,        // Current block's randomness beacon
                blockhash(block.number - 1), // Recent block hash
                block.timestamp,         // Current timestamp
                req.blockNumber         // Original request block (for uniqueness)
            ));
        }

        // 4. Generate Random Words
        uint256[] memory randomWords = new uint256[](req.numWords);
        for (uint256 i = 0; i < req.numWords; i++) {
            randomWords[i] = uint256(
                keccak256(
                    abi.encodePacked(
                        nextServerSeed, 
                        req.userSeed, 
                        bh,
                        requestId, 
                        i
                    )
                )
            );
        }

        // 5. Callback
        bytes memory resp;
        if (req.reqType == RequestType.Chainlink) {
            // Selector for rawFulfillRandomness(uint256,uint256[])
            resp = abi.encodeWithSignature(
                "rawFulfillRandomness(uint256,uint256[])",
                requestId,
                randomWords
            );
        } else {
            // Pyth Style: entropyCallback(uint64,address,bytes32)
            resp = abi.encodeWithSignature(
                "entropyCallback(uint64,address,bytes32)",
                uint64(requestId),
                address(this),
                bytes32(randomWords[0])
            );
        }

        (bool success, ) = req.sender.call{gas: req.callbackGasLimit}(resp);
        
        emit RandomWordsFulfilled(requestId, randomWords[0], 0, success);
    }

    // -------------------------------------------------------------------------
    // View / Verification Functions
    // -------------------------------------------------------------------------

    /**
     * @notice Verifies the result, assuming one knows the correct seed used for that request.
     * Note: Since `currentAnchor` updates, you can't verify OLD requests against the CURRENT anchor.
     * You verify them against the anchor state *at that time*. 
     * This view function calculates the math solely based on inputs.
     */
    function verifyRandomness(
        uint256 requestId, 
        bytes32 serverSeedRevealed
    ) external view returns (bool isValid, uint256[] memory randomWords) {
        Request memory req = s_requests[requestId];
        
        if (req.sender == address(0)) return (false, new uint256[](0));
        
        bytes32 bh = blockhash(req.blockNumber);
        if (bh == bytes32(0)) return (false, new uint256[](0));

        randomWords = new uint256[](req.numWords);
        for (uint256 i = 0; i < req.numWords; i++) {
            randomWords[i] = uint256(
                keccak256(
                    abi.encodePacked(
                        serverSeedRevealed, 
                        req.userSeed, 
                        bh,
                        requestId, 
                        i
                    )
                )
            );
        }

        return (true, randomWords);
    }
}
