# Pyth to FairVRF Adapter

## Overview

The `PythToFairVRFAdapter` allows you to use FairVRF with zero code changes to your existing Pyth Entropy contracts. Simply deploy the adapter and change the Pyth Entropy address to the adapter address.

## Benefits

- **Zero Code Changes**: Keep your existing Pyth-based contract exactly as is
- **Zero VRF Fees**: FairVRF has no randomness request fees
- **Same Interface**: Perfect compatibility with Pyth Entropy V2
- **Auto Refunds**: Any ETH sent is automatically refunded
- **Same Security**: Cryptographically verifiable randomness

## Quick Setup

### 1. Deploy the Adapter

```bash
# Deploy adapter pointing to your FairVRF coordinator
npx hardhat ignition deploy ignition/modules/PythToFairVRFAdapter.ts --network your-network --parameters '{"fairVRFCoordinator": "0x14ba174823e16DD8747a2A16F62333ad43C23CEB"}'
```

### 2. Update Your Contract Address

In your existing AdventCalendar contract:

```solidity
// OLD: Point to Pyth Entropy
// entropy = IEntropyV2(0x...pyth_entropy_address);

// NEW: Point to FairVRF Adapter (ONLY change the address!)
entropy = IEntropyV2(0x...adapter_address);
```

That's it. No other code changes needed.

## Example Usage

### Your Existing Code (No Changes!)

```solidity
// This code stays exactly the same:
uint256 fee = entropy.getFeeV2(CALLBACK_GAS_LIMIT); // Returns 0 (free!)
uint64 sequenceNumber = entropy.requestV2{value: fee}(CALLBACK_GAS_LIMIT);

// Callback also stays the same:
function entropyCallback(
    uint64 sequenceNumber,
    address provider,
    bytes32 randomValue
) internal override {
    // Your existing callback logic unchanged
}
```

## How It Works

1. **Request Translation**: Adapter receives Pyth `requestV2()` calls and translates them to FairVRF `requestRandomWords()`
2. **ID Mapping**: Maps FairVRF request IDs to Pyth sequence numbers for compatibility
3. **Callback Translation**: Receives FairVRF callbacks and forwards them as Pyth `entropyCallback()`
4. **Fee Handling**: Returns 0 for `getFeeV2()` and refunds any ETH sent

## Deployment Example

```typescript
// Deploy adapter
const adapter = await ethers.deployContract("PythToFairVRFAdapter", [
    "0x14ba174823e16DD8747a2A16F62333ad43C23CEB" // FairVRF coordinator
]);

// Use adapter address in your existing contract
await adventCalendar.setEntropy(adapter.address);
```

## Gas Costs

- **Pyth Entropy**: ~0.01-0.1 ETH per request (network dependent)
- **FairVRF Adapter**: Only gas costs (typically ~30-50k gas)

## Security Considerations

- The adapter maintains the same security properties as FairVRF
- All randomness is cryptographically verifiable using hash chains
- No trust assumptions beyond what FairVRF already requires

## Limitations

- Maintains Pyth's `uint64` sequence number format (FairVRF uses `uint256`)
- Callback gas limits are preserved but may need adjustment for complex callbacks
- Provider address in callbacks will be the adapter address, not original Pyth provider

## Testing

See `test/PythToFairVRFAdapter.ts` for comprehensive test suite covering:
- Request/response flow
- Fee calculations
- Callback forwarding
- Error handling
- Gas optimization
