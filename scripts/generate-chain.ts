import { keccak256, toHex } from 'viem';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { randomBytes } from 'crypto';
import * as dotenv from 'dotenv';
import { updateContractAnchor, logContractUpdateResult } from '../server/src/contract-updater.js';

// Load environment variables
dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function main() {
    const CHAIN_LENGTH = 100000; // 1000 for demo, can be 10000
    console.log(`Generating hash chain of length ${CHAIN_LENGTH}...`);

    // 1. Generate the "Secret" (The end of the chain / s_n)
    // This is the seed we will reveal LAST.
    const secret = toHex(randomBytes(32));
    
    const chain: string[] = [secret];
    let current = secret;

    // 2. Hash backwards
    // If secret is s_10000, we hash it to get s_9999, etc.
    for (let i = 0; i < CHAIN_LENGTH; i++) {
        current = keccak256(current as `0x${string}`);
        chain.push(current);
    }

    // 3. Prepare for saving
    // chain is now [s_n, s_{n-1}, ..., s_0] where s_0 is the last element pushed.
    // s_0 is the Public Anchor.
    // We want the array to be [s_0, s_1, s_2, ..., s_n].
    // chain[0] = s_0 (Anchor).
    // chain[1] = s_1 (First reveal). H(s_1) == s_0.
    
    const finalChain = chain.reverse();

    console.log("--------------------------------------------------");
    console.log("Anchor (s_0):", finalChain[0]);
    console.log("First Secret (s_1):", finalChain[1]);
    console.log("Last Secret (s_n):", finalChain[finalChain.length - 1]);
    console.log("--------------------------------------------------");

    // Create server dir if not exists
    const serverDir = path.join(__dirname, '../server');
    if (!fs.existsSync(serverDir)) {
        fs.mkdirSync(serverDir);
    }

    const outputPath = path.join(serverDir, 'chain.db.json');
    fs.writeFileSync(outputPath, JSON.stringify(finalChain, null, 2));
    
    console.log(`Chain saved to ${outputPath}`);

    // 4. Auto-update contract using the utility
    await attemptContractUpdate(finalChain[0]);
}

async function attemptContractUpdate(newAnchor: string): Promise<void> {
    const contractAddress = process.env.CONTRACT_ADDRESS;
    const privateKey = process.env.PRIVATE_KEY;

    if (!contractAddress) {
        console.log('CONTRACT_ADDRESS not set - skipping automatic contract update');
        console.log('To enable automatic updates, set CONTRACT_ADDRESS in your .env file');
        return;
    }

    if (!privateKey) {
        console.log('PRIVATE_KEY not set - skipping automatic contract update');
        console.log('To enable automatic updates, set PRIVATE_KEY in your .env file');
        return;
    }

    console.log('Attempting to update contract anchor...');
    console.log(`Contract Address: ${contractAddress}`);
    console.log(`New Anchor: ${newAnchor}`);

    // Use the contract updater utility with dynamic chain detection
    const result = await updateContractAnchor(newAnchor, {
        chainId: process.env.CHAIN_ID ? parseInt(process.env.CHAIN_ID) : undefined
    });
    
    // Log the result
    logContractUpdateResult(newAnchor, result, contractAddress);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
