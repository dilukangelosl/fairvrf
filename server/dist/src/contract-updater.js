import { createPublicClient, createWalletClient, http, parseAbiItem } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { defineChain } from 'viem';
import * as dotenv from 'dotenv';
// Load environment variables
dotenv.config();
/**
 * Creates a dynamic chain configuration based on the RPC URL
 */
function createChainConfig(rpcUrl, chainId) {
    // If chainId is provided, use it; otherwise try to auto-detect from common URLs
    let detectedChainId = chainId;
    if (!detectedChainId) {
        if (rpcUrl.includes('localhost') || rpcUrl.includes('127.0.0.1')) {
            detectedChainId = 31337; // Hardhat default
        }
        else if (rpcUrl.includes('apechain')) {
            detectedChainId = 33139; // ApeChain
        }
        else {
            // Default to 1 (Ethereum mainnet) if we can't detect
            detectedChainId = 1;
        }
    }
    return defineChain({
        id: detectedChainId,
        name: `Chain ${detectedChainId}`,
        network: `chain-${detectedChainId}`,
        nativeCurrency: {
            decimals: 18,
            name: 'Ether',
            symbol: 'ETH',
        },
        rpcUrls: {
            default: {
                http: [rpcUrl],
            },
            public: {
                http: [rpcUrl],
            },
        },
    });
}
/**
 * Updates the anchor in a FairVRF contract
 */
export async function updateContractAnchor(newAnchor, config) {
    const contractAddress = config?.contractAddress || process.env.CONTRACT_ADDRESS;
    const privateKey = config?.privateKey || process.env.PRIVATE_KEY;
    const rpcUrl = config?.rpcUrl || process.env.RPC_URL || 'http://localhost:8545';
    if (!contractAddress) {
        return {
            success: false,
            error: 'CONTRACT_ADDRESS not provided'
        };
    }
    if (!privateKey) {
        return {
            success: false,
            error: 'PRIVATE_KEY not provided'
        };
    }
    try {
        // Create account from private key
        const account = privateKeyToAccount(privateKey);
        // Create dynamic chain configuration
        const chain = createChainConfig(rpcUrl, config?.chainId);
        // Create clients with the dynamic chain
        const publicClient = createPublicClient({
            chain,
            transport: http(rpcUrl),
        });
        const walletClient = createWalletClient({
            account,
            chain,
            transport: http(rpcUrl),
        });
        // Prepare the transaction
        // Using the correct function name from FairVRF contract: setAnchor(bytes32 _newAnchor)
        const { request } = await publicClient.simulateContract({
            address: contractAddress,
            abi: [parseAbiItem('function setAnchor(bytes32 _newAnchor) external')],
            functionName: 'setAnchor',
            args: [newAnchor],
            account,
        });
        // Execute the transaction
        const hash = await walletClient.writeContract(request);
        // Wait for confirmation
        const receipt = await publicClient.waitForTransactionReceipt({ hash });
        if (receipt.status === 'success') {
            return {
                success: true,
                transactionHash: hash,
                blockNumber: receipt.blockNumber,
                gasUsed: receipt.gasUsed,
            };
        }
        else {
            return {
                success: false,
                error: 'Transaction failed - check contract state',
                transactionHash: hash,
            };
        }
    }
    catch (error) {
        return {
            success: false,
            error: error.message || 'Unknown error occurred',
        };
    }
}
/**
 * Creates an anchor update callback for use with ChainManager
 */
export function createAnchorUpdateCallback(config) {
    return async (newAnchor) => {
        const result = await updateContractAnchor(newAnchor, config);
        if (!result.success) {
            throw new Error(`Failed to update contract anchor: ${result.error}`);
        }
        console.log(`Contract anchor updated successfully!`);
        console.log(`Transaction: ${result.transactionHash}`);
        console.log(`Block: ${result.blockNumber}`);
        console.log(`Gas: ${result.gasUsed}`);
    };
}
/**
 * Logs the result of a contract update attempt
 */
export function logContractUpdateResult(newAnchor, result, contractAddress) {
    if (result.success) {
        console.log('Contract anchor updated successfully!');
        console.log(`Contract: ${contractAddress}`);
        console.log(`New Anchor: ${newAnchor}`);
        console.log(`Transaction: ${result.transactionHash}`);
        console.log(`Block Number: ${result.blockNumber}`);
        console.log(`Gas Used: ${result.gasUsed}`);
    }
    else {
        console.error('Failed to update contract anchor:', result.error);
        console.log('');
        console.log('Troubleshooting:');
        console.log('   1. Ensure CONTRACT_ADDRESS is correct');
        console.log('   2. Ensure PRIVATE_KEY has sufficient balance');
        console.log('   3. Ensure the contract has a setAnchor(bytes32) function');
        console.log('   4. Ensure RPC_URL is accessible');
        console.log('   5. Ensure CHAIN_ID matches the network (set CHAIN_ID=33139 for ApeChain)');
        console.log('');
        console.log('Manual Update Required:');
        console.log(`   Call setAnchor("${newAnchor}") on contract ${contractAddress}`);
    }
}
//# sourceMappingURL=contract-updater.js.map