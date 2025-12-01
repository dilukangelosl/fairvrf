import { createPublicClient, http, parseAbiItem, defineChain, keccak256, encodeAbiParameters } from 'viem';
import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const RPC_URL = process.env.RPC_URL || 'https://rpc.apechain.com';
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;

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

async function debugChain() {
    console.log('🔍 Debugging hash chain synchronization...');
    
    try {
        // Get current anchor from contract
        const currentAnchor = await client.readContract({
            address: CONTRACT_ADDRESS,
            abi: [parseAbiItem('function currentAnchor() view returns (bytes32)')],
            functionName: 'currentAnchor',
        });
        console.log(`📍 Current contract anchor: ${currentAnchor}`);
        
        // Load local chain
        const chainPath = './chain.db.json';
        if (!fs.existsSync(chainPath)) {
            console.error('❌ Local chain file not found at ./chain.db.json');
            return;
        }
        
        const chain = JSON.parse(fs.readFileSync(chainPath, 'utf8'));
        console.log(`📊 Local chain loaded: ${chain.length} seeds`);
        
        // Find current position in local chain
        const currentIndex = chain.findIndex(seed => seed === currentAnchor);
        if (currentIndex === -1) {
            console.error('❌ Current anchor not found in local chain!');
            console.log('This means the chain is out of sync.');
            console.log('First few seeds in chain:', chain.slice(0, 5));
            return;
        }
        
        console.log(`📍 Current anchor found at index ${currentIndex} in local chain`);
        
        // Check next seed
        if (currentIndex >= chain.length - 1) {
            console.error('❌ Chain exhausted! No more seeds available.');
            return;
        }
        
        const nextSeed = chain[currentIndex + 1];
        console.log(`🔄 Next seed should be: ${nextSeed}`);
        
        // Verify hash relationship
        const nextSeedHash = keccak256(nextSeed);
        console.log(`🔐 Hash of next seed: ${nextSeedHash}`);
        console.log(`✅ Hash matches current anchor: ${nextSeedHash === currentAnchor ? 'YES' : 'NO'}`);
        
        console.log(`📊 Chain status: ${currentIndex}/${chain.length - 1} seeds used (${((currentIndex / (chain.length - 1)) * 100).toFixed(1)}%)`);
        
        if (nextSeedHash !== currentAnchor) {
            console.error('❌ Hash chain verification failed!');
            console.log('This indicates a problem with the chain generation or synchronization.');
        }
        
    } catch (error) {
        console.error('❌ Error:', error.message);
    }
}

debugChain();
