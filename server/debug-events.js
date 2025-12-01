import { createPublicClient, http, parseAbiItem, defineChain } from 'viem';
import * as dotenv from 'dotenv';

dotenv.config();

const RPC_URL = process.env.RPC_URL || 'https://rpc.apechain.com';
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

// Define ApeChain
const apechain = defineChain({
    id: 33139,
    name: 'ApeChain',
    network: 'apechain',
    nativeCurrency: { decimals: 18, name: 'ApeCoin', symbol: 'APE' },
    rpcUrls: { default: { http: [RPC_URL] } },
    blockExplorers: { default: { name: 'ApeScan', url: 'https://apescan.io' } },
});

const client = createPublicClient({
    chain: apechain,
    transport: http(RPC_URL)
});

async function debugEvents() {
    console.log('🔍 Debugging event detection...');
    console.log(`Contract: ${CONTRACT_ADDRESS}`);
    console.log(`RPC: ${RPC_URL}`);
    
    try {
        // Get current block
        const currentBlock = await client.getBlockNumber();
        console.log(`Current block: ${currentBlock}`);
        
        // Check for RandomWordsRequested events in last 1000 blocks
        const fromBlock = currentBlock - 1000n;
        
        console.log(`\n🔍 Checking for RandomWordsRequested events from block ${fromBlock} to ${currentBlock}...`);
        
        const logs = await client.getContractEvents({
            address: CONTRACT_ADDRESS,
            abi: [parseAbiItem('event RandomWordsRequested(bytes32 indexed keyHash, uint256 requestId, uint256 preSeed, uint64 indexed subId, uint16 minimumRequestConfirmations, uint32 callbackGasLimit, uint32 numWords, address indexed sender)')],
            eventName: 'RandomWordsRequested',
            fromBlock: fromBlock,
            toBlock: currentBlock
        });
        
        console.log(`Found ${logs.length} RandomWordsRequested events`);
        
        if (logs.length > 0) {
            console.log('\n📋 Recent events:');
            logs.forEach((log, i) => {
                console.log(`${i+1}. Block ${log.blockNumber}: RequestId ${log.args.requestId} from ${log.args.sender}`);
            });
        }
        
        // Check if our server account can read contract
        console.log(`\n🔍 Testing contract read access...`);
        const currentAnchor = await client.readContract({
            address: CONTRACT_ADDRESS,
            abi: [parseAbiItem('function currentAnchor() view returns (bytes32)')],
            functionName: 'currentAnchor',
        });
        console.log(`✅ Current anchor: ${currentAnchor}`);
        
        // Check fulfiller address
        const fulfiller = await client.readContract({
            address: CONTRACT_ADDRESS,
            abi: [parseAbiItem('function fulfiller() view returns (address)')],
            functionName: 'fulfiller',
        });
        console.log(`✅ Fulfiller address: ${fulfiller}`);
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

debugEvents();
