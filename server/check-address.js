import { privateKeyToAccount } from 'viem/accounts';
import * as dotenv from 'dotenv';

dotenv.config();

const PRIVATE_KEY = process.env.PRIVATE_KEY;

if (!PRIVATE_KEY) {
    console.error('No PRIVATE_KEY found in .env');
    process.exit(1);
}

const account = privateKeyToAccount(PRIVATE_KEY);
console.log('Current private key corresponds to address:', account.address);
console.log('Required fulfiller address:', '0x923e7d9EE4af64D70b96cEd718d735d246531869');
console.log('Match:', account.address.toLowerCase() === '0x923e7d9EE4af64D70b96cEd718d735d246531869'.toLowerCase() ? '✅ YES' : '❌ NO');
