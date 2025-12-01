Updated PRD: FairVRF (Hash Chain Edition)
1. Smart Contract (FairVRF.sol)
State Variables
code
Solidity
address public fulfiller;
bytes32 public currentAnchor; // The hash of the PREVIOUS seed
uint256 public requestCounter;
mapping(uint256 => Request) public requests;
Functions
A. initializeAnchor(bytes32 _anchor)
Description: Called once by admin to set the end of the hash chain.
Input: The hash of the first seed to be used (technically the last one generated).
B. requestRandomness(bytes32 userSeed)
Gas Cost: Low (~40k gas).
Logic:
Store requests[requestId] = { userSeed, fulfilled: false }.
Emit RandomRequested(requestId).
C. fulfillRandomness(uint256 requestId, bytes32 nextServerSeed)
Gas Cost: Super Low (~30-50k gas).
Logic:
Verify: require(keccak256(nextServerSeed) == currentAnchor, "Invalid seed proof");
Update: currentAnchor = nextServerSeed; (The revealed seed becomes the anchor for the next request).
Mix: finalRandom = keccak256(abi.encode(nextServerSeed, req.userSeed, blockhash...)).
Callback: Send finalRandom to user.
2. Server Logic (Off-Chain)
The server is slightly more complex because it must manage the chain state.
A. generate-chain.ts (Script)
Generate a random Secret_N (e.g., Seed #10,000).
Loop 10,000 times: Previous = keccak256(Current).
Save the entire list to a JSON file (chain.db.json).
The final result (Seed_0) is what you deploy to the contract.
B. service.ts (The Bot)
State: Keep track of currentIndex (starts at 1).
On Request:
Read chain.db.json.
Get seed at currentIndex.
Send to contract.
currentIndex++.
Complete MD Spec for AI Agent
Copy this block below for your AI agent. It implements the Hash Chain method.
Technical PRD: FairVRF (Reverse Hash Chain Architecture)
1. Overview
FairVRF is a gas-optimized, self-hosted randomness oracle.
Architecture: Reverse Hash Chain (PayWord scheme).
Trust Model: The server commits to a chain anchor (H(S_1)) on-chain. To fulfill a request, it reveals S_1. The contract verifies keccak256(S_1) == Anchor. S_1 becomes the new Anchor. This mathematically proves the seed was pre-generated and not manipulated based on the user's input.
2. Directory Structure
code
Text
fairvrf/
├── contracts/
│   ├── FairVRF.sol              # Hash Chain Logic
│   ├── FairVRFConsumer.sol      # Abstract Consumer
│   └── interfaces/
│       └── IFairVRF.sol
├── scripts/
│   └── generate-chain.ts        # Off-chain tool to create seed chain
├── server/
│   ├── src/
│   │   ├── index.ts
│   │   ├── service.ts
│   │   └── chain-manager.ts     # Handles reading the JSON chain
│   ├── chain.db.json            # The secret database of pre-images
│   └── Dockerfile
└── test/
    └── FairVRF.test.ts
3. Smart Contract Specification (FairVRF.sol)
State
bytes32 public currentAnchor: The validator hash for the next allowed seed.
mapping(uint256 => Request) requests: Stores user entropy.
Functions
constructor(address _fulfiller)
Set owner and fulfiller.
setAnchor(bytes32 _newAnchor)
Auth: Only Owner.
Usage: Resets the chain (if seeds run out or server is lost).
requestRandomWords(...)
Logic:
Accepts numWords, callbackGas.
Records msg.sender, userSeed (hashed from params), and blockNumber.
Crucial: Does not assign a seed index. The next valid fulfillment updates the global state.
fulfillRandomness(uint256 requestId, bytes32 nextNextSeed)
Input: nextSeed (The pre-image of the current anchor).
Validation:
code
Solidity
require(keccak256(nextSeed) == currentAnchor, "Wrong seed revealed");
State Update:
code
Solidity
currentAnchor = nextSeed; // Move chain forward
Entropy Generation:
code
Solidity
bytes32 randomness = keccak256(abi.encode(
    nextSeed, 
    req.userSeed, 
    blockhash(req.targetBlock),
    requestId
));
4. Off-Chain Scripts
scripts/generate-chain.ts
Goal: Create a cryptographic chain of 10,000 seeds.
Algorithm:
code
TypeScript
let seed = randomBytes(32); // The last seed (Seed_10000)
const chain = [seed];
for(i=0; i<10000; i++) {
    seed = keccak256(seed);
    chain.push(seed);
}
// chain[0] is Seed_10000
// chain[10000] is Seed_0 (The Public Anchor)
saveToFile(chain.reverse()); 
// Now chain[0] is Anchor, chain[1] is first secret...
server/src/chain-manager.ts
Logic:
Load chain.db.json.
Read on-chain currentAnchor.
Find the index in the JSON file where keccak256(entry) == currentAnchor.
The answer to the request is entry (the pre-image).
5. Security & Limitations
Sequential Processing: Requests must be fulfilled in order (1, 2, 3...) because the global anchor updates sequentially.
AI Instruction: Ensure the server uses a MutEx or queue to process one transaction at a time to prevent "Nonce too low" or invalid anchor errors.
Liveness: If the server loses the chain.db.json, the protocol stops. Admin must run setAnchor with a new chain.
6. Testing Guide
Test 1: Generate a chain of length 5. Deploy with Chain[0].
Test 2: Request randomness.
Test 3: Fulfill with Chain[2] -> REVERT (Skipped a link).
Test 4: Fulfill with Chain[1] -> SUCCESS. currentAnchor updates to Chain[1].
Test 5: Next request fulfills with Chain[2] -> SUCCESS.