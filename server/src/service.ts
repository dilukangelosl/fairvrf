import { createPublicClient, createWalletClient, http, parseAbiItem } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hardhat } from 'viem/chains';
import { ChainManager } from './chain-manager.js';
import * as dotenv from 'dotenv';

dotenv.config();

// Configuration
const RPC_URL = process.env.RPC_URL || 'http://127.0.0.1:8545/';
// Default hardhat account #0 private key - REPLACE IN PROD
const PRIVATE_KEY = (process.env.PRIVATE_KEY || '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80') as `0x${string}`;
const CONTRACT_ADDRESS = (process.env.CONTRACT_ADDRESS) as `0x${string}`;

// Service metrics
interface ServiceMetrics {
    totalRequests: number;
    successfulFulfillments: number;
    failedFulfillments: number;
    averageResponseTime: number;
    uptime: number;
    lastHealthCheck: Date;
}

class FairVRFService {
    private client: any;
    private wallet: any;
    private chainManager: ChainManager;
    private metrics: ServiceMetrics;
    private startTime: Date;

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

    private startHealthMonitoring(): void {
        setInterval(() => {
            this.updateMetrics();
            this.logHealthStatus();
        }, 30000); // Every 30 seconds
    }

    private updateMetrics(): void {
        const now = new Date();
        this.metrics.uptime = now.getTime() - this.startTime.getTime();
        this.metrics.lastHealthCheck = now;
    }

    private logHealthStatus(): void {
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

    async start(): Promise<void> {
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
            onLogs: async (logs: any[]) => {
                for (const log of logs) {
                    await this.handleRandomnessRequest(log, abi);
                }
            }
        });

        console.log("Service started successfully!");
        
        // Keep process alive
        await new Promise(() => {});
    }

    private async handleRandomnessRequest(log: any, abi: any[]): Promise<void> {
        const startTime = Date.now();
        const { requestId, minimumRequestConfirmations } = log.args;
        const blockNumber = log.blockNumber;
        
        if (!requestId) return;

        this.metrics.totalRequests++;
        console.log(`\n[Request #${requestId}] Detected in block ${blockNumber}!`);
        console.log(`Waiting ${minimumRequestConfirmations} confirmations...`);

        try {
            // Get current anchor from contract
            const currentAnchor = await this.client.readContract({
                address: CONTRACT_ADDRESS,
                abi: abi,
                functionName: 'currentAnchor',
            }) as string;

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
                args: [requestId, nextSeed as `0x${string}`]
            });

            const responseTime = Date.now() - startTime;
            this.metrics.successfulFulfillments++;
            this.updateAverageResponseTime(responseTime);

            console.log(`[Request #${requestId}] Fulfilled! Tx: ${hash}`);
            console.log(`Response time: ${responseTime}ms`);

        } catch (error: any) {
            this.metrics.failedFulfillments++;
            console.error(`[Request #${requestId}] Failed:`, error.message);
            
            // Handle chain rotation errors gracefully
            if (error.message.includes('Chain Exhausted')) {
                console.error('CRITICAL: Hash chain exhausted! Manual intervention required!');
            }
        }
    }

    private updateAverageResponseTime(responseTime: number): void {
        // Fix: Calculate average properly, accounting for the new fulfillment count
        const previousTotal = this.metrics.averageResponseTime * (this.metrics.successfulFulfillments - 1);
        this.metrics.averageResponseTime = (previousTotal + responseTime) / this.metrics.successfulFulfillments;
    }

    // Public API for monitoring
    public getMetrics(): ServiceMetrics {
        this.updateMetrics();
        return { ...this.metrics };
    }

    public getChainHealth() {
        return this.chainManager.getHealthMetrics();
    }

    public getChainStats() {
        return this.chainManager.getChainStats();
    }

    public async rotateChain(chainLength?: number): Promise<string> {
        console.log('Manual chain rotation triggered...');
        return this.chainManager.rotateChain(chainLength);
    }

    /**
     * Update the contract anchor automatically when chain rotation occurs
     */
    private async updateContractAnchor(newAnchor: string): Promise<void> {
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
                args: [newAnchor as `0x${string}`]
            });

            console.log(`📝 Contract anchor update transaction: ${hash}`);
            
            // Wait for confirmation
            const receipt = await this.client.waitForTransactionReceipt({ hash });
            
            if (receipt.status === 'success') {
                console.log(`✅ Contract anchor successfully updated to: ${newAnchor}`);
                console.log(`⛽ Gas used: ${receipt.gasUsed.toString()}`);
            } else {
                throw new Error('Transaction failed');
            }
            
        } catch (error: any) {
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
