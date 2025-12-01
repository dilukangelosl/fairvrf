# FairVRF: Self-Hosted Provably Fair VRF

A gas-efficient, self-hosted Verifiable Random Function (VRF) that serves as a drop-in replacement for Chainlink VRF and Pyth Entropy. Built using reverse hash chain architecture (PayWord model) for cryptographic verifiability without external dependencies.

## Table of Contents

- [Problem & Research](#problem--research)
- [Solution Architecture](#solution-architecture)
- [Features](#features)
- [Quick Start](#quick-start)
- [Installation](#installation)
- [Usage Examples](#usage-examples)
- [API Reference](#api-reference)
- [Deployment Guide](#deployment-guide)
- [Automatic Contract Updates](#automatic-contract-updates)
- [Consumer Management](#consumer-management)
- [Chain Management](#chain-management)
- [Security Considerations](#security-considerations)
- [Migration Guide](#migration-guide)
- [Contributing](#contributing)

## Problem & Research

### The Cost Problem

Existing VRF solutions impose significant operational costs:

- **Chainlink VRF**: $0.25 - $3.00 per request + LINK token requirements
- **Pyth Entropy**: Network-specific fees + subscription costs
- **External Dependencies**: Risk of service deprecation or network unavailability

For high-frequency applications (GameFi, on-chain casinos, NFT minting), these costs make projects economically unviable.

### Research & Inspiration

The solution draws inspiration from several cryptographic primitives:

1. **PayWord Scheme (Rivest & Shamir, 1997)**: Micropayment system using hash chains for efficient verification
2. **Provably Fair Gaming**: Standard practice in online gambling where operators pre-commit to random seeds
3. **Lamport's One-Time Passwords**: Sequential revelation of hash chain elements for authentication

### Why Hash Chains Work for VRF

Hash chains provide:
- **Pre-commitment**: Server commits to entire sequence upfront
- **Sequential Verification**: Each revelation proves previous commitment
- **Tamper Evidence**: Impossible to manipulate without detection
- **Gas Efficiency**: Single hash operation for verification (~21,000 gas)

## Solution Architecture

### Reverse Hash Chain Model

```
Server generates: s_1000 -> s_999 -> ... -> s_1 -> s_0 (anchor)
                    |        |              |      |
                  secret  intermediate   first   public
                           values       reveal  commitment
```

1. **Generation**: Server creates 1000 random seeds, hashes backward
2. **Deployment**: Contract stores s_0 as public anchor
3. **Fulfillment**: Server reveals s_1, contract verifies `keccak256(s_1) == s_0`
4. **Progression**: s_1 becomes new anchor for next request

### Entropy Mixing Formula

```solidity
finalRandom = keccak256(
    abi.encodePacked(
        serverSeed,      // Revealed from hash chain
        userSeed,        // Derived from request parameters
        blockhash,       // Block randomness at request time
        requestId        // Unique request identifier
    )
);
```

This ensures:
- Server cannot manipulate outcome after seeing user input
- User cannot grind favorable conditions
- Block randomness adds unpredictability
- Each request has unique context

## Features

### Core Capabilities

- **Zero External Costs**: Only gas fees, no token requirements
- **Chainlink Compatible**: Drop-in replacement with identical API
- **Pyth Compatible**: Support for Entropy-style callbacks
- **Provably Fair**: Users can verify randomness generation
- **Gas Optimized**: ~30-50k gas per fulfillment
- **Self-Sovereign**: No external dependencies
- **Automatic Chain Management**: Built-in chain rotation with contract synchronization

### Supported Interfaces

1. **Chainlink VRF V2 Style**:
   ```solidity
   requestRandomWords(keyHash, subId, confirmations, gasLimit, numWords)
   ```

2. **Pyth Entropy Style**:
   ```solidity
   requestWithCallback(provider, userRandomNumber)
   ```

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/dilukangelosl/fairvrf.git
cd fairvrf
npm install
```

### 2. Generate Hash Chain with Auto-Update

```bash
# Configure for automatic contract updates
export CONTRACT_ADDRESS=0x48c579b565de9FBfd2E6800952b947E090Ff9cd0
export PRIVATE_KEY=0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
export CHAIN_ID=33139  # Optional: Auto-detected for common networks

# Generate chain and update contract automatically
npx tsx scripts/generate-chain.ts
```

This creates `server/chain.db.json` with 1000 pre-computed seeds and automatically updates the contract anchor if configured.

### 3. Deploy Contract

```bash
npx hardhat ignition deploy ignition/modules/FairVRF.ts --network hardhatMainnet
```

### 4. Start Oracle Server

```bash
export CONTRACT_ADDRESS=<deployed_contract_address>
export PRIVATE_KEY=<fulfiller_private_key>
cd server && npm run start
```

### 5. Test Everything

```bash
npx hardhat test
```

## Installation

### Prerequisites

- Node.js v22+ (Hardhat 3 requirement)
- pnpm (recommended) or npm
- Git

### Project Setup

```bash
# Clone repository
git clone https://github.com/dilukangelosl/fairvrf.git
cd fairvrf

# Install dependencies
pnpm install

# Compile contracts
pnpm compile

# Run tests
pnpm test
```

### Environment Configuration

Create `.env` file:

```env
# Required for server operation
CONTRACT_ADDRESS=0x...
PRIVATE_KEY=0x...
RPC_URL=http://127.0.0.1:8545

# Optional: For automatic contract updates
CHAIN_ID=33139  # Auto-detected if not specified

# Optional: Production networks
SEPOLIA_RPC_URL=https://...
SEPOLIA_PRIVATE_KEY=0x...
```

## Usage Examples

### Chainlink-Style Consumer

```solidity
pragma solidity ^0.8.28;

import "fair-vrf/contracts/FairVRFConsumer.sol";

contract DiceGame is FairVRFConsumer {
    constructor(address _vrfCoordinator) 
        FairVRFConsumer(_vrfCoordinator) {}

    function rollDice() external returns (uint256 requestId) {
        // Request randomness
        requestId = IFairVRF(COORDINATOR).requestRandomWords(
            bytes32(0), // keyHash (ignored)
            0,          // subId (ignored)  
            3,          // confirmations
            100000,     // callback gas limit
            1           // number of random words
        );
    }

    function fulfillRandomWords(
        uint256 requestId, 
        uint256[] memory randomWords
    ) internal override {
        // Use randomWords[0] for game logic
        uint8 diceResult = uint8((randomWords[0] % 6) + 1);
        // Handle result...
    }
}
```

### Pyth-Style Consumer

```solidity
pragma solidity ^0.8.28;

import "fair-vrf/contracts/PythVRFConsumer.sol";

contract LotteryGame is PythVRFConsumer {
    constructor(address _vrfCoordinator) 
        PythVRFConsumer(_vrfCoordinator) {}

    function drawWinner() external {
        bytes32 userEntropy = keccak256(abi.encode(
            block.timestamp,
            players.length
        ));

        uint64 sequenceNumber = IFairVRFPyth(COORDINATOR)
            .requestWithCallback(address(this), userEntropy);
    }

    function fulfillEntropy(
        uint64 sequenceNumber,
        address provider,
        bytes32 randomNumber
    ) internal override {
        // Select winner using randomNumber
        uint256 winnerIndex = uint256(randomNumber) % players.length;
        // Handle winner selection...
    }
}
```

### Pyth Adapter Bridge

For seamless integration with existing Pyth Entropy contracts, FairVRF includes a **PythToFairVRFAdapter** that provides complete API compatibility:

**Deployed Addresses (ApeChain):**
- FairVRF Core: `0x48c579b565de9FBfd2E6800952b947E090Ff9cd0`
- Pyth Adapter: `0x9Ae17f3cCFB9a2C754cEd486BE9eaA6cf088c48E`
- Example Consumer: `0x30439aA46cd85b68353575e4d8634479AB52B80C`

#### Drop-in Replacement Usage

```solidity
pragma solidity ^0.8.28;

// NO CHANGES NEEDED! Use your existing Pyth contracts
contract ExistingPythContract {
    IEntropy public entropy;
    
    constructor(address entropyProvider) {
        // Simply point to PythToFairVRFAdapter instead
        entropy = IEntropy(0x9Ae17f3cCFB9a2C754cEd486BE9eaA6cf088c48E);
    }
    
    function requestRandomness() external {
        // Your existing Pyth code works unchanged!
        bytes32 userRandom = keccak256(abi.encode(msg.sender, block.timestamp));
        
        uint64 sequenceNumber = entropy.requestWithCallback{value: 0}(
            address(entropy), // provider (ignored by adapter)
            userRandom
        );
        
        // Store sequence number for tracking...
    }
    
    function entropyCallback(
        uint64 sequenceNumber,
        address provider,
        bytes32 randomNumber
    ) external {
        // Your existing callback logic works unchanged!
        require(msg.sender == address(entropy), "Unauthorized");
        
        // Use randomNumber for your application...
    }
}
```

#### Adapter Features

✅ **100% Pyth API Compatible** - Zero code changes required  
✅ **Fee-Free Operation** - No ETH fees (unlike real Pyth Entropy)  
✅ **Instant Fulfillment** - No waiting for external providers  
✅ **Self-Hosted** - No external dependencies  
✅ **Provably Fair** - Full cryptographic verifiability  

#### Deployment Example

```bash
# Deploy the complete Pyth-compatible stack
npx hardhat ignition deploy ignition/modules/FairVRF.ts --network apechain
npx hardhat ignition deploy ignition/modules/PythToFairVRFAdapter.ts --network apechain
npx hardhat ignition deploy ignition/modules/PythExampleConsumer.ts --network apechain

# Test the integration
npx hardhat run scripts/interact-pyth-example.ts --network apechain
```

The adapter automatically handles:
- Event translation between Pyth and FairVRF formats
- Callback routing to original requester contracts  
- Error handling and edge cases
- Gas optimization for batch operations

## API Reference

### Core Contract: FairVRF.sol

#### Request Functions

```solidity
// Chainlink-compatible interface
function requestRandomWords(
    bytes32 keyHash,        // Ignored (compatibility)
    uint64 subId,          // Ignored (compatibility)
    uint16 requestConfirmations,
    uint32 callbackGasLimit,
    uint32 numWords
) external returns (uint256 requestId);

// Pyth-compatible interface  
function requestWithCallback(
    address provider,       // Ignored (this contract is provider)
    bytes32 userRandomNumber
) external payable returns (uint64 sequenceNumber);
```

#### Fulfillment Function

```solidity
function fulfillRandomness(
    uint256 requestId,
    bytes32 nextServerSeed  // Next seed in hash chain
) external;
```

#### Anchor Management Functions

```solidity
// Update the contract anchor (owner only)
function setAnchor(bytes32 _newAnchor) external onlyOwner;

// Get current anchor
function currentAnchor() external view returns (bytes32);
```

#### Consumer Whitelist Management

```solidity
// Enable/disable consumer whitelist (owner only)
function setConsumerWhitelistEnabled(bool _enabled) external;

// Authorize/deauthorize single consumer (owner only)
function setConsumerAuthorization(address _consumer, bool _authorized) external;

// Batch authorize multiple consumers (owner only)
function batchSetConsumerAuthorization(
    address[] calldata _consumers,
    bool[] calldata _authorized
) external;

// Check consumer authorization
function authorizedConsumers(address consumer) external view returns (bool);
function consumerWhitelistEnabled() external view returns (bool);
```

#### View Functions

```solidity
function verifyRandomness(
    uint256 requestId,
    bytes32 serverSeedRevealed
) external view returns (bool isValid, uint256[] memory randomWords);

function currentAnchor() external view returns (bytes32);
```

### Consumer Base Contracts

#### FairVRFConsumer.sol

```solidity
abstract contract FairVRFConsumer {
    function fulfillRandomWords(
        uint256 requestId, 
        uint256[] memory randomWords
    ) internal virtual;
}
```

#### PythVRFConsumer.sol

```solidity
abstract contract PythVRFConsumer {
    function fulfillEntropy(
        uint64 sequenceNumber,
        address provider,
        bytes32 randomNumber
    ) internal virtual;
}
```

## Deployment Guide

### Local Development

```bash
# Start Hardhat node
npx hardhat node

# Generate chain with auto-update
export CONTRACT_ADDRESS=<deployed_address>
export PRIVATE_KEY=<owner_private_key>
npx tsx scripts/generate-chain.ts

# Deploy contracts
npx hardhat ignition deploy ignition/modules/FairVRF.ts --network localhost

# Start server
cd server && npm run start
```

### Production Deployment

#### 1. Generate Production Chain with Auto-Update

```bash
# Configure environment for production
export CONTRACT_ADDRESS=0x48c579b565de9FBfd2E6800952b947E090Ff9cd0
export PRIVATE_KEY=0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef  
export CHAIN_ID=33139  # ApeChain
export RPC_URL=https://rpc.apechain.com

# Modify scripts/generate-chain.ts for production scale
const CHAIN_LENGTH = 100000; // 100k requests

# Generate and auto-update contract
npx tsx scripts/generate-chain.ts
```

**Expected Output:**
```
Generating hash chain of length 100000...
Chain saved to /path/to/server/chain.db.json
Attempting to update contract anchor...
Contract Address: 0x14ba174823e16DD8747a2A16F62333ad43C23CEB
New Anchor: 0xaf035cf003e12923901e9d8713231a7dfb9f901363a68328abe86811dc60d046
Contract anchor updated successfully!
Transaction: 0xf418baa6eec13ad9129359b36bb2ce899b369f26af9a68c7c8d3879baec4b2ca
Block Number: 29480738
Gas Used: 30632
```

#### 2. Deploy to Network

```bash
npx hardhat ignition deploy ignition/modules/FairVRF.ts --network sepolia
```

#### 3. Docker Deployment

##### Environment Variables

| Variable | Description | Required | Default | Example |
|----------|-------------|----------|---------|---------|
| `CONTRACT_ADDRESS` | Deployed FairVRF contract address | ✅ | - | `0x14ba...` |
| `PRIVATE_KEY` | Private key for fulfillment account | ✅ | - | `0x923e...` |
| `RPC_URL` | Blockchain RPC endpoint | ❌ | `http://127.0.0.1:8545` | `https://rpc.apechain.com` |
| `CHAIN_ID` | Network chain ID (auto-detected) | ❌ | Auto-detected | `33139` |
| `NODE_ENV` | Runtime environment | ❌ | `development` | `production` |

##### Option A: Docker Compose (Recommended)

```bash
# Create environment file
cat > .env << EOF
CONTRACT_ADDRESS=0x48c579b565de9FBfd2E6800952b947E090Ff9cd0
PRIVATE_KEY=0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
RPC_URL=https://rpc.apechain.com
CHAIN_ID=33139
NODE_ENV=production
EOF

# Build and start the service
docker-compose up -d --build

# Check logs
docker-compose logs -f fairvrf-server

# Stop the service
docker-compose down
```

##### Option B: Coolify Docker Deployment

For **Coolify** deployments, use the following configuration:

**1. Repository Setup:**
```bash
# Your repository should contain the server/ directory with:
server/
├── Dockerfile
├── package.json  
├── src/
├── chain.db.json  # Generated hash chain (see below)
└── .env.example
```

**2. Environment Variables in Coolify:**
```env
CONTRACT_ADDRESS=0x48c579b565de9FBfd2E6800952b947E090Ff9cd0
PRIVATE_KEY=0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef
RPC_URL=https://rpc.apechain.com  
CHAIN_ID=33139
NODE_ENV=production
PORT=3000
```

**3. Dockerfile Configuration:**
The existing `server/Dockerfile` is already optimized for Coolify:

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm install --production
COPY . .
RUN npm run build
EXPOSE 3000
CMD ["npm", "start"]
```

**4. Automatic Chain Generation:**

The Docker container automatically generates the hash chain database on startup - **no manual generation required!**

```bash
# The container handles chain generation automatically based on environment variables:
# CHAIN_LENGTH=100000  # Default: 100k seeds for production
# CONTRACT_ADDRESS=0x... # Your deployed FairVRF contract
# PRIVATE_KEY=0x...     # Private key for anchor updates
```

**Container Startup Process:**
1. **Check Existing Chain**: If `chain.db.json` exists, skip generation
2. **Generate Chain**: Create new hash chain with specified length  
3. **Save Database**: Store chain in `/app/chain.db.json` inside container
4. **Start Server**: Launch FairVRF service with generated chain

**Benefits:**
- **Zero Manual Setup** - Everything happens automatically
- **No Large Files in Repo** - Chain generated at runtime  
- **Configurable Chain Size** - Set `CHAIN_LENGTH` env var
- **Persistent Storage** - Chain persists across container restarts (if using volumes)
- **Production Ready** - Optimized for 100k+ seed chains

**5. Deploy via Coolify:**

1. **Create New Service** in Coolify dashboard
2. **Select Git Repository** containing your FairVRF code
3. **Set Build Pack** to `Docker` 
4. **Set Context Directory** to `server/`
5. **Configure Environment Variables** (as shown above)
6. **Set Port** to `3000`
7. **Deploy**

**6. Verify Deployment:**

```bash
# Check if your server is running
curl https://your-coolify-app.com/health

# Expected response:
# {"status":"healthy","uptime":123,"requests":0}
```

**7. Monitor Logs:**

In Coolify dashboard:
- Go to your service → **Logs** tab
- Look for: `"Service started successfully!"`
- Monitor for: `"📡 New event detected: RequestId X"`

**Important Notes for Coolify:**

- **Persistent Storage**: Hash chain is stored in `chain.db.json` - make sure this file is committed to your repo
- **Environment Variables**: All configuration is done via Coolify env vars, no `.env` file needed
- **Health Checks**: Server exposes `/health` endpoint for monitoring
- **Log Monitoring**: Enable log aggregation in Coolify to monitor fulfillment activity
- **Scaling**: Run single instance only (hash chain state is not shared across instances)

**Troubleshooting Coolify Deployment:**

```bash
# If deployment fails, check:
1. server/Dockerfile exists and is valid
2. server/package.json has correct dependencies  
3. server/chain.db.json exists and is valid JSON
4. Environment variables are set correctly in Coolify
5. Port 3000 is properly exposed

# Common issues:
- "Module not found": Missing dependencies in package.json
- "Chain file not found": Missing chain.db.json file
- "Contract address invalid": Wrong CONTRACT_ADDRESS env var
- "Connection failed": Wrong RPC_URL or network issues
```

## Automatic Contract Updates

FairVRF includes built-in automatic contract anchor update functionality that eliminates manual intervention during chain generation and rotation.

### Features

- **Zero-Downtime Rotation**: Server continues operating during chain transitions
- **Automatic Synchronization**: Contract anchor stays in sync with server chain
- **Multi-Network Support**: Works across different blockchain networks
- **Intelligent Chain Detection**: Automatically detects network based on RPC URL
- **Robust Error Handling**: Graceful degradation when automation fails

### Configuration

#### Environment Variables

```env
# Required for automatic updates
CONTRACT_ADDRESS=0x48c579b565de9FBfd2E6800952b947E090Ff9cd0
PRIVATE_KEY=0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef

# Optional: Network configuration
RPC_URL=https://rpc.apechain.com
CHAIN_ID=33139  # Auto-detected if not specified
```

#### Supported Networks

| Network | Chain ID | Auto-Detection | RPC Pattern |
|---------|----------|----------------|-------------|
| Hardhat Local | 31337 | ✅ | `localhost`, `127.0.0.1` |
| ApeChain | 33139 | ✅ | `apechain` |
| Custom | Any | Manual | Set `CHAIN_ID` env var |

### Usage Examples

#### Manual Chain Generation with Auto-Update

```bash
# Generate new chain and update contract automatically
CHAIN_ID=33139 npx tsx scripts/generate-chain.ts
```

#### Server-Side Automatic Rotation

The server includes intelligent chain management:

```javascript
// Automatic rotation configuration
const rotationConfig = {
  enabled: true,
  thresholdPercentage: 80,     // Trigger at 80% utilization
  minRemainingSeeds: 100,      // Or when <100 seeds remain
  autoGenerateNewChain: true,  // Generate new chains automatically
  chainLength: 10000           // New chain size
};
```

**Server Output Example:**
```
Loaded chain with 1000 seeds.
Rotation strategy: ENABLED
  - Threshold: 80% utilization
  - Min remaining: 100 seeds
  - Auto-generate: YES

ROTATION NEEDED! Chain utilization: 80.0%
   Remaining seeds: 200/1000
Auto-generating new hash chain...
Generating new hash chain with 10000 seeds...
Backed up old chain to: chain_backup_2025-12-01T09-43-09-115Z.json
Saved new chain to: chain.db.json
New anchor (s0): 0xdd3392333c82e5e65673495b90d7793caa699a145df6e2f90e404ae69f873f0a
Auto-updating contract anchor...
Contract anchor updated successfully!
```

### Error Handling

When automatic updates fail, the system provides clear troubleshooting guidance:

```
Failed to update contract anchor: invalid chain id for signer: have 31337 want 33139

Troubleshooting:
   1. Ensure CONTRACT_ADDRESS is correct
   2. Ensure PRIVATE_KEY has sufficient balance  
   3. Ensure the contract has a setAnchor(bytes32) function
   4. Ensure RPC_URL is accessible
   5. Ensure CHAIN_ID matches the network (set CHAIN_ID=33139 for ApeChain)

Manual Update Required:
   Call setAnchor("0xnew_anchor_hash") on contract 0x14ba174823e16DD8747a2A16F62333ad43C23CEB
```

### Integration with ChainManager

```typescript
// Enable automatic contract updates in ChainManager
const chainManager = new ChainManager(rotationStrategy, chainPath, {
  onAnchorUpdate: createAnchorUpdateCallback({
    contractAddress: process.env.CONTRACT_ADDRESS,
    privateKey: process.env.PRIVATE_KEY,
    chainId: process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID) : undefined
  })
});
```

## Consumer Management

### Consumer Whitelist Feature

FairVRF includes an optional consumer whitelist feature for enhanced security and access control. By default, the contract operates in **open access mode** (like Chainlink VRF), but administrators can enable whitelisting to restrict usage to approved contracts only.

#### Default Behavior

- **Whitelist Disabled**: Anyone can call `requestRandomWords()` or `requestWithCallback()` 
- **Fully Permissionless**: No restrictions, identical to Chainlink VRF behavior
- **Backward Compatible**: Existing integrations work without changes

#### Enabling Consumer Whitelist

```bash
# Check current whitelist status
export CONTRACT_ADDRESS=0x... 
npx hardhat run scripts/manage-consumers.ts status --network sepolia

# Enable consumer whitelist (restricts access)
npx hardhat run scripts/manage-consumers.ts enable --network sepolia

# Disable consumer whitelist (open access)
npx hardhat run scripts/manage-consumers.ts disable --network sepolia
```

#### Managing Authorized Consumers

```bash
# Authorize a single consumer contract
npx hardhat run scripts/manage-consumers.ts authorize 0x1234567890123456789012345678901234567890 --network sepolia

# Deauthorize a consumer
npx hardhat run scripts/manage-consumers.ts deauthorize 0x1234567890123456789012345678901234567890 --network sepolia

# Batch authorize multiple consumers
npx hardhat run scripts/manage-consumers.ts batch-authorize 0x1111...,0x2222...,0x3333... --network sepolia

# Check if a specific consumer is authorized
npx hardhat run scripts/manage-consumers.ts check 0x1234567890123456789012345678901234567890 --network sepolia
```

#### Programmatic Management

```solidity
// Check if whitelist is enabled
bool isWhitelistEnabled = fairVRF.consumerWhitelistEnabled();

// Check if a consumer is authorized
bool isAuthorized = fairVRF.authorizedConsumers(consumerAddress);

// Owner-only functions
fairVRF.setConsumerWhitelistEnabled(true);  // Enable whitelist
fairVRF.setConsumerAuthorization(consumer, true);  // Authorize consumer
fairVRF.batchSetConsumerAuthorization(consumers, authorizations);  // Batch authorize
```

#### Use Cases

**Open Access (Default)**
- Public VRF service
- Chainlink VRF replacement
- Community-driven projects
- Maximum compatibility

**Restricted Access (Whitelist Enabled)**
- Private enterprise deployments
- Premium service tiers  
- Beta testing environments
- Regulatory compliance requirements

#### Security Considerations

- **Owner Control**: Only contract owner can manage whitelist settings
- **Granular Access**: Individual consumer authorization/deauthorization
- **Batch Operations**: Efficient management of multiple consumers
- **Event Logging**: All authorization changes emit events for monitoring
- **Fail-Safe Design**: Whitelist disabled by default prevents accidental lockouts

## Chain Management

### Understanding Chain Exhaustion

Each hash chain has finite capacity. With 1000 seeds:
- Supports 1000 randomness requests
- Chain exhausts after final seed revelation
- Server throws: "Chain Exhausted! Admin must commit a new anchor."

### Monitoring Chain Status

```javascript
// Calculate remaining capacity
function getRemainingRequests(currentAnchor, chainData) {
    const currentIndex = chainData.indexOf(currentAnchor);
    return chainData.length - currentIndex - 1;
}

// Alert when low
if (getRemainingRequests() < 100) {
    // Generate new chain and prepare for rotation
}
```

### Chain Rotation Process

#### Automated Rotation

```solidity
// Add to FairVRF contract
function setAnchor(bytes32 _newAnchor) external onlyOwner {
    bytes32 oldAnchor = currentAnchor;
    currentAnchor = _newAnchor;
    emit AnchorUpdated(oldAnchor, _newAnchor);
}
```

#### Server Implementation

```javascript
// server/src/chain-rotation.js
class ChainRotationManager {
    async rotateChainWhenLow() {
        if (this.getRemainingSeeds() < this.ROTATION_THRESHOLD) {
            await this.generateNewChain();
            await this.deployNewAnchor();
            await this.loadNewChain();
        }
    }
}
```

### Scaling Considerations

| Chain Size | Capacity | Use Case |
|------------|----------|----------|
| 1,000 | Development/Testing | Local dev, demos |
| 10,000 | Small Production | Indie games, small dApps |
| 100,000 | Medium Production | GameFi platforms |
| 1,000,000+ | Large Production | Major gambling platforms |

## Security Considerations

### Trust Model

**What Users Must Trust:**
- Server will fulfill requests (liveness)
- Server won't selectively censor requests

**What Users DON'T Need to Trust:**
- Server cannot manipulate randomness
- All results are cryptographically verifiable
- Pre-commitment prevents post-hoc manipulation

### Attack Vectors & Mitigations

#### 1. Server Downtime
- **Risk**: Requests hang unfulfilled
- **Mitigation**: Implement request timeout and refund mechanism

#### 2. Selective Fulfillment
- **Risk**: Server only fulfills favorable outcomes
- **Mitigation**: Social reputation, multiple server operators

#### 3. Chain Loss
- **Risk**: Server loses chain.db.json file
- **Mitigation**: Encrypted backups, redundant storage

#### 4. Sequencer Manipulation (L2/L3)
- **Risk**: Sequencer censors fulfillment transactions
- **Mitigation**: Use L1 blockhash, assume honest sequencer

### Verification Guide

Users can verify any result:

```javascript
// Verify a randomness result
function verifyResult(requestId, revealedSeed, expectedAnchor) {
    // 1. Check seed matches commitment
    const computedHash = keccak256(revealedSeed);
    assert(computedHash === expectedAnchor);
    
    // 2. Recompute final randomness
    const finalRandom = keccak256(
        revealedSeed + 
        userSeed + 
        blockHash + 
        requestId
    );
    
    return finalRandom;
}
```

## Migration Guide

### From Chainlink VRF

#### 1. Contract Changes

```diff
// Old Chainlink import
- import "@chainlink/contracts/src/v0.8/VRFConsumerBaseV2.sol";
+ import "fair-vrf/contracts/FairVRFConsumer.sol";

// Old inheritance
- contract MyGame is VRFConsumerBaseV2 {
+ contract MyGame is FairVRFConsumer {

// Constructor update
- constructor(uint64 subscriptionId) 
-   VRFConsumerBaseV2(vrfCoordinator) {
+ constructor(address vrfCoordinator) 
+   FairVRFConsumer(vrfCoordinator) {
```

#### 2. Request Changes

```diff
// Old Chainlink request
- uint256 requestId = COORDINATOR.requestRandomWords(
-   keyHash,
-   s_subscriptionId,
-   requestConfirmations,
-   callbackGasLimit,
-   numWords
- );

// New FairVRF request (same parameters!)
+ uint256 requestId = IFairVRF(COORDINATOR).requestRandomWords(
+   bytes32(0),        // keyHash ignored
+   0,                 // subId ignored
+   requestConfirmations,
+   callbackGasLimit,
+   numWords
+ );
```

#### 3. Callback Unchanged

```solidity
// This stays exactly the same!
function fulfillRandomWords(
    uint256 requestId,
    uint256[] memory randomWords
) internal override {
    // Your existing logic works unchanged
}
```

### From Pyth Entropy

#### 1. Interface Changes

```diff
- import "@pythnetwork/entropy-sdk-solidity/IEntropy.sol";
+ import "fair-vrf/contracts/PythVRFConsumer.sol";

- contract MyLottery {
+ contract MyLottery is PythVRFConsumer {
```

#### 2. Request Method

```diff
- uint64 sequenceNumber = entropy.requestWithCallback{value: fee}(
-   entropyProvider,
-   userCommittedRandomNumber
- );

+ uint64 sequenceNumber = IFairVRFPyth(COORDINATOR).requestWithCallback(
+   address(this),
+   userCommittedRandomNumber
+ );
```

## Contributing

### Development Setup

```bash
# Fork and clone
git clone <your-fork>
cd fairvrf

# Install dependencies
pnpm install

# Run tests
pnpm test

# Start development node
pnpm node
```

### Testing

```bash
# Run all tests
pnpm test

# Run specific test file
npx hardhat test test/FairVRF.ts

# Run with coverage
npx hardhat coverage
```

### Code Quality

```bash
# Lint Solidity
pnpm lint:sol

# Lint TypeScript
pnpm lint:ts

# Format code
pnpm format
```

### Submitting Changes

1. Fork the repository
2. Create feature branch: `git checkout -b feature/amazing-feature`
3. Make changes and add tests
4. Ensure all tests pass: `pnpm test`
5. Commit changes: `git commit -m 'Add amazing feature'`
6. Push to branch: `git push origin feature/amazing-feature`
7. Open Pull Request

## License

MIT License - see [LICENSE](LICENSE) file for details.

## Acknowledgments

- **Rivest & Shamir**: PayWord micropayment scheme inspiration
- **Chainlink Team**: VRF API design and standards
- **Pyth Network**: Entropy interface patterns
- **Provably Fair Gaming**: Community standards for verifiable randomness

## Support

- Documentation: [docs/](docs/)
- Issues: [GitHub Issues](issues/)
- Discussions: [GitHub Discussions](discussions/)
- Twitter: [@cryptoangelodev](https://x.com/cryptoangelodev)

---

Built with love for the decentralized future. Make randomness free and verifiable for everyone.
