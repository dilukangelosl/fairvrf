#!/usr/bin/env node

/**
 * Docker Chain Generation Script (CommonJS)
 * Generates hash chain database during container startup
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');

// Configuration from environment variables
const CHAIN_LENGTH = parseInt(process.env.CHAIN_LENGTH || '100000'); // 100k by default for production
const CHAIN_FILE = path.join(__dirname, '..', 'chain.db.json');
const CONTRACT_ADDRESS = process.env.CONTRACT_ADDRESS;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

/**
 * Update contract anchor using the built contract updater
 */
async function updateContractAnchor(newAnchor) {
    return new Promise((resolve, reject) => {
        console.log('   Calling contract updater...');
        
        // Use the built contract updater by spawning node process
        const updaterPath = path.join(__dirname, '..', 'dist', 'src', 'contract-updater.js');
        
        // Create a temporary script to call the updater
        const tempScript = `
const { updateContractAnchor, logContractUpdateResult } = require('${updaterPath}');
updateContractAnchor('${newAnchor}', {
    contractAddress: '${CONTRACT_ADDRESS}',
    privateKey: '${PRIVATE_KEY}',
    rpcUrl: '${process.env.RPC_URL || 'https://rpc.apechain.com'}',
    chainId: ${process.env.CHAIN_ID || 33139}
}).then(result => {
    logContractUpdateResult('${newAnchor}', result, '${CONTRACT_ADDRESS}');
    process.exit(result.success ? 0 : 1);
}).catch(error => {
    console.error('Contract update failed:', error.message);
    process.exit(1);
});
`;
        
        // Write temp script and execute
        const tempFile = path.join(__dirname, '..', 'temp-update.js');
        fs.writeFileSync(tempFile, tempScript);
        
        const child = spawn('node', [tempFile], {
            stdio: 'inherit',
            env: process.env
        });
        
        child.on('close', (code) => {
            // Clean up temp file
            try {
                fs.unlinkSync(tempFile);
            } catch (e) {
                // Ignore cleanup errors
            }
            
            if (code === 0) {
                resolve();
            } else {
                reject(new Error(`Contract update failed with code ${code}`));
            }
        });
        
        child.on('error', (error) => {
            reject(error);
        });
    });
}

async function main() {

console.log('FairVRF Docker Chain Generation');
console.log('===============================');
console.log(`Chain Length: ${CHAIN_LENGTH.toLocaleString()} seeds`);
console.log(`Target File: ${CHAIN_FILE}`);
console.log(`Contract: ${CONTRACT_ADDRESS || 'Not configured'}`);
console.log('');

// Check if chain already exists
if (fs.existsSync(CHAIN_FILE)) {
    console.log('Chain database already exists - skipping generation');
    try {
        const existing = JSON.parse(fs.readFileSync(CHAIN_FILE, 'utf8'));
        console.log(`   Existing chain: ${existing.chain?.length || 0} seeds`);
        console.log(`   Created: ${existing.metadata?.created || 'Unknown'}`);
        process.exit(0);
    } catch (error) {
        console.log('WARNING: Existing chain file is corrupted - regenerating');
    }
}

console.log('Generating new hash chain...');
const startTime = Date.now();

// Generate the reverse hash chain
const chain = [];
let current = crypto.randomBytes(32).toString('hex');

// Build chain backwards (s_n -> s_{n-1} -> ... -> s_0)
for (let i = 0; i < CHAIN_LENGTH; i++) {
    chain.unshift('0x' + current);
    current = crypto.createHash('sha256').update(Buffer.from(current, 'hex')).digest('hex');
    
    // Progress indicator for large chains
    if ((i + 1) % 10000 === 0) {
        const progress = ((i + 1) / CHAIN_LENGTH * 100).toFixed(1);
        console.log(`   Progress: ${progress}% (${(i + 1).toLocaleString()} seeds)`);
    }
}

const generationTime = Date.now() - startTime;

// Create chain data structure
const chainData = {
    chain,
    length: CHAIN_LENGTH,  // Add this for compatibility
    metadata: {
        length: CHAIN_LENGTH,
        created: new Date().toISOString(),
        generatedBy: 'docker-startup',
        generationTimeMs: generationTime,
        anchor: chain[0], // s_0 (the public anchor)
        contractAddress: CONTRACT_ADDRESS || null,
        environment: process.env.NODE_ENV || 'development'
    }
};

// Save to file
try {
    fs.writeFileSync(CHAIN_FILE, JSON.stringify(chainData, null, 2));
    console.log('');
    console.log('Hash chain generated successfully!');
    console.log(`   Seeds: ${CHAIN_LENGTH.toLocaleString()}`);
    console.log(`   Anchor (s0): ${chain[0]}`);
    console.log(`   Generation time: ${(generationTime / 1000).toFixed(1)}s`);
    console.log(`   File size: ${(fs.statSync(CHAIN_FILE).size / 1024 / 1024).toFixed(1)} MB`);
    console.log('');
    
    // Automatic contract anchor update
    if (CONTRACT_ADDRESS && PRIVATE_KEY) {
        console.log('Updating contract anchor automatically...');
        console.log(`   Contract: ${CONTRACT_ADDRESS}`);
        console.log(`   New Anchor: ${chain[0]}`);
        
        await updateContractAnchor(chain[0]);
    } else {
        console.log('Manual Contract Update Required:');
        console.log(`   Call setAnchor("${chain[0]}") on your FairVRF contract`);
    }
    
    console.log('');
    console.log('Ready to start FairVRF server!');
    
} catch (error) {
    console.error('Failed to save chain database:', error.message);
    process.exit(1);
}

}

// Run the main function
main().catch((error) => {
    console.error('Script failed:', error.message);
    process.exit(1);
});
