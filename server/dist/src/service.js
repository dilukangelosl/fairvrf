import { createPublicClient, createWalletClient, http, parseAbiItem } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';
import { ChainManager } from './chain-manager.js';
import * as dotenv from 'dotenv';
dotenv.config();
// Configuration
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545/';
// Default hardhat account #0 private key - REPLACE IN PROD
const PRIVATE_KEY = (process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80');
const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS);
class FairVRFService {
    client;
    wallet;
    chainManager;
    metrics;
    startTime;
    constructor() {
        const account = privateKeyToAccount(PRIVATE_KEY);
        this.client = createPublicClient({
            chain: hardhat,
            transport: http(RPC_URL)
        });
        this.wallet = createWalletClient({
            account,
            chain: hardhat,
            transport: http(RPC_URL)
        });
        this.chainManager = new ChainManager({
            enabled: true,
            thresholdPercentage: 80,
            minRemainingSeeds: 50,
            autoGenerateNewChain: true,
            autoUpdateContract: true // Enable automatic contract updates
        });
        // Set up automatic anchor update callback
        this.chainManager.setAnchorUpdateCallback(this.updateContractAnchor.bind(this));
        this.startTime = new Date();
        this.metrics = {
            totalRequests: 0,
            successfulFulfillments: 0,
            failedFulfillments: 0,
            averageResponseTime: 0,
            uptime: 0,
            lastHealthCheck: new Date()
        };
        // Start health monitoring
        this.startHealthMonitoring();
    }
    startHealthMonitoring() {
        setInterval(() => {
            this.updateMetrics();
            this.logHealthStatus();
        }, 30000); // Every 30 seconds
    }
    updateMetrics() {
        const now = new Date();
        this.metrics.uptime = now.getTime() - this.startTime.getTime();
        this.metrics.lastHealthCheck = now;
    }
    logHealthStatus() {
        const chainStats = this.chainManager.getChainStats();
        const healthMetrics = this.chainManager.getHealthMetrics();
        console.log('\n=== FAIRVRF SERVICE STATUS ===');
        console.log(`Uptime: ${Math.round(this.metrics.uptime / 1000 / 60)} minutes`);
        console.log(`Requests: ${this.metrics.totalRequests} (Success: ${this.metrics.successfulFulfillments} / Failed: ${this.metrics.failedFulfillments})`);
        console.log(`Chain: ${chainStats.currentIndex + 1}/${chainStats.totalSeeds} seeds used (${chainStats.utilizationPercentage.toFixed(1)}%)`);
        console.log(`Health: ${healthMetrics.status.toUpperCase()}`);
        if (healthMetrics.recommendations.length > 0) {
            console.log('Recommendations:');
            healthMetrics.recommendations.forEach(rec => console.log(`   - ${rec}`));
        }
        console.log('==================================\n');
    }
    async start() {
        console.log("Starting FairVRF Oracle Service...");
        console.log(`Connected to ${RPC_URL}`);
        console.log(`Watching Contract: ${CONTRACT_ADDRESS}`);
        // ABI Definitions
        const abi = [
            parseAbiItem('event RandomWordsRequested(bytes32 indexed keyHash, uint256 requestId, uint256 preSeed, uint64 indexed subId, uint16 minimumRequestConfirmations, uint32 callbackGasLimit, uint32 numWords, address indexed sender)'),
            parseAbiItem('function fulfillRandomness(uint256 requestId, bytes32 nextServerSeed) external'),
            parseAbiItem('function currentAnchor() view returns (bytes32)')
        ];
        // Initial health check
        const healthMetrics = this.chainManager.getHealthMetrics();
        console.log(`Initial chain health: ${healthMetrics.status.toUpperCase()}`);
        // Watch for events
        this.client.watchEvent({
            address: CONTRACT_ADDRESS,
            event: parseAbiItem('event RandomWordsRequested(bytes32 indexed keyHash, uint256 requestId, uint256 preSeed, uint64 indexed subId, uint16 minimumRequestConfirmations, uint32 callbackGasLimit, uint32 numWords, address indexed sender)'),
            onLogs: async (logs) => {
                for (const log of logs) {
                    await this.handleRandomnessRequest(log, abi);
                }
            }
        });
        console.log("Service started successfully!");
        // Keep process alive
        await new Promise(() => { });
    }
    async handleRandomnessRequest(log, abi) {
        const startTime = Date.now();
        const { requestId, minimumRequestConfirmations } = log.args;
        const blockNumber = log.blockNumber;
        if (!requestId)
            return;
        this.metrics.totalRequests++;
        console.log(`\n[Request #${requestId}] Detected in block ${blockNumber}!`);
        console.log(`Waiting ${minimumRequestConfirmations} confirmations...`);
        try {
            // Get current anchor from contract
            const currentAnchor = await this.client.readContract({
                address: CONTRACT_ADDRESS,
                abi: abi,
                functionName: 'currentAnchor',
            });
            console.log(`Current anchor: ${currentAnchor}`);
            // Find next seed using enhanced chain manager
            const nextSeed = this.chainManager.getNextSeed(currentAnchor);
            console.log(`Next seed found: ${nextSeed}`);
            // Check chain health after each use
            const stats = this.chainManager.getChainStats();
            if (stats.shouldRotate) {
                console.warn(`Chain rotation needed! ${stats.remainingSeeds} seeds remaining`);
            }
            // Fulfill the request
            const hash = await this.wallet.writeContract({
                address: CONTRACT_ADDRESS,
                abi: abi,
                functionName: 'fulfillRandomness',
                args: [requestId, nextSeed]
            });
            const responseTime = Date.now() - startTime;
            this.metrics.successfulFulfillments++;
            this.updateAverageResponseTime(responseTime);
            console.log(`[Request #${requestId}] Fulfilled! Tx: ${hash}`);
            console.log(`Response time: ${responseTime}ms`);
        }
        catch (error) {
            this.metrics.failedFulfillments++;
            console.error(`[Request #${requestId}] Failed:`, error.message);
            // Handle chain rotation errors gracefully
            if (error.message.includes('Chain Exhausted')) {
                console.error('CRITICAL: Hash chain exhausted! Manual intervention required!');
            }
        }
    }
    updateAverageResponseTime(responseTime) {
        // Fix: Calculate average properly, accounting for the new fulfillment count
        const previousTotal = this.metrics.averageResponseTime * (this.metrics.successfulFulfillments - 1);
        this.metrics.averageResponseTime = (previousTotal + responseTime) / this.metrics.successfulFulfillments;
    }
    // Public API for monitoring
    getMetrics() {
        this.updateMetrics();
        return { ...this.metrics };
    }
    getChainHealth() {
        return this.chainManager.getHealthMetrics();
    }
    getChainStats() {
        return this.chainManager.getChainStats();
    }
    async rotateChain(chainLength) {
        console.log('Manual chain rotation triggered...');
        return this.chainManager.rotateChain(chainLength);
    }
    /**
     * Update the contract anchor automatically when chain rotation occurs
     */
    async updateContractAnchor(newAnchor) {
        console.log(`🔄 Updating contract anchor to: ${newAnchor}`);
        try {
            // ABI for setAnchor function
            const setAnchorAbi = [
                parseAbiItem('function setAnchor(bytes32 _newAnchor) external')
            ];
            // Call setAnchor on the contract
            const hash = await this.wallet.writeContract({
                address: CONTRACT_ADDRESS,
                abi: setAnchorAbi,
                functionName: 'setAnchor',
                args: [newAnchor]
            });
            console.log(`📝 Contract anchor update transaction: ${hash}`);
            // Wait for confirmation
            const receipt = await this.client.waitForTransactionReceipt({ hash });
            if (receipt.status === 'success') {
                console.log(`✅ Contract anchor successfully updated to: ${newAnchor}`);
                console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);
            }
            else {
                throw new Error('Transaction failed');
            }
        }
        catch (error) {
            console.error(`❌ Failed to update contract anchor:`, error);
            throw error; // Re-throw to trigger fallback handling in ChainManager
        }
    }
}
async function main() {
    if (!CONTRACT_ADDRESS) {
        console.error("Please set CONTRACT_ADDRESS env var");
        process.exit(1);
    }
    const service = new FairVRFService();
    await service.start();
}
main().catch((error) => {
    console.error('Service crashed:', error);
    process.exit(1);
});
// Export for testing
export { FairVRFService };
//# sourceMappingURL=service.js.map