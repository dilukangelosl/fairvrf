import { createPublicClient, createWalletClient, http, parseAbiItem } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { defineChain } from 'viem';
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
        
        // Define ApeChain configuration
        const apechain = defineChain({
            id: 33139,
            name: 'ApeChain',
            network: 'apechain',
            nativeCurrency: {
                decimals: 18,
                name: 'ApeCoin',
                symbol: 'APE',
            },
            rpcUrls: {
                default: {
                    http: [RPC_URL],
                },
            },
            blockExplorers: {
                default: { name: 'ApeScan', url: 'https://apescan.io' },
            },
        });

        this.client = createPublicClient({
            chain: apechain,
            transport: http(RPC_URL)
        });

        this.wallet = createWalletClient({
            account,
            chain: apechain,
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
        const successRate = this.metrics.totalRequests > 0 
            ? ((this.metrics.successfulFulfillments / this.metrics.totalRequests) * 100).toFixed(1)
            : '0.0';
        
        console.log('\n=== FAIRVRF SERVICE STATUS ===');
        console.log(`Uptime: ${Math.round(this.metrics.uptime / 1000 / 60)} minutes`);
        console.log(`Requests: ${this.metrics.totalRequests} (Success: ${this.metrics.successfulFulfillments} / Failed: ${this.metrics.failedFulfillments}) - ${successRate}% success rate`);
        console.log(`Chain: ${chainStats.currentIndex + 1}/${chainStats.totalSeeds} seeds used (${chainStats.utilizationPercentage.toFixed(1)}%)`);
        console.log(`Health: ${healthMetrics.status.toUpperCase()}`);
        console.log(`Failed Requests in Queue: ${this.failedRequests.size}`);
        console.log(`Last Block Processed: ${this.lastProcessedBlock}`);
        console.log(`Avg Response Time: ${this.metrics.averageResponseTime.toFixed(0)}ms`);
        
        if (healthMetrics.recommendations.length > 0) {
            console.log('Recommendations:');
            healthMetrics.recommendations.forEach(rec => console.log(`   - ${rec}`));
        }
        
        // Show failed requests summary
        if (this.failedRequests.size > 0) {
            console.log('Failed Requests:');
            for (const [key, failed] of this.failedRequests.entries()) {
                const timeSinceLastAttempt = Math.round((Date.now() - failed.lastAttempt) / 1000);
                console.log(`   - ${key}: ${failed.attempts} attempts, last tried ${timeSinceLastAttempt}s ago`);
            }
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
        
        // Event monitoring via polling (ApeChain RPC doesn't support persistent filters)
        console.log("🔄 Setting up event monitoring via polling...");
        
        // Use polling as primary method (every 5 seconds for better responsiveness)
        this.startEventPolling(abi);
        
        console.log("✅ Event polling enabled (every 5 seconds)");
        
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
        
        // Get current block to check if we're within the 256 block window
        const currentBlock = await this.client.getBlockNumber();
        const blockAge = currentBlock - blockNumber;
        
        if (blockAge >= 200n) {
            console.warn(`⚠️ Request is ${blockAge} blocks old - too old to process safely. Skipping to avoid BlockHashNotAvailable.`);
            return;
        }
        
        console.log(`📊 Block age: ${blockAge} blocks (processing immediately to stay within 256 block limit)`);

        try {
            // First, check if this request has already been fulfilled
            const fulfillmentCheckAbi = [
                parseAbiItem('function requests(uint256) view returns (bool exists, bool fulfilled, uint64 subId, uint32 callbackGasLimit, uint32 numWords, address requester)')
            ];
            
            let requestStatus;
            try {
                requestStatus = await this.client.readContract({
                    address: CONTRACT_ADDRESS,
                    abi: fulfillmentCheckAbi,
                    functionName: 'requests',
                    args: [requestId]
                }) as any[];
                
                if (requestStatus && requestStatus[1] === true) { // fulfilled = true
                    console.log(`✅ Request #${requestId} already fulfilled - skipping`);
                    this.metrics.successfulFulfillments++; // Count as success since it's fulfilled
                    return;
                }
            } catch (error) {
                // If requests() function doesn't exist, continue with fulfillment attempt
                console.log(`ℹ️ Cannot check fulfillment status (contract may not have requests() function) - proceeding with fulfillment`);
            }
            
            console.log(`🔄 Request #${requestId} not yet fulfilled - processing...`);
            // Get fresh anchor from contract (critical for concurrent requests)
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

    private lastProcessedBlock = 0n;
    private processedRequests = new Set<string>();
    private failedRequests = new Map<string, { log: any, attempts: number, lastAttempt: number }>();
    private pollingActive = false;

    private startEventPolling(abi: any[]): void {
        console.log("🔄 Starting enhanced event polling (every 3 seconds)...");
        console.log("🛡️ Features enabled:");
        console.log("   - Automatic retry for failed requests");
        console.log("   - Overlapping block ranges to prevent gaps");
        console.log("   - Failed request recovery system");
        console.log("   - Block reorganization protection");
        
        // Main polling loop
        setInterval(async () => {
            if (this.pollingActive) {
                console.log("⏸️ Skipping poll cycle - previous cycle still running");
                return;
            }
            
            this.pollingActive = true;
            try {
                await this.pollForEvents(abi);
                await this.retryFailedRequests(abi);
            } catch (error: any) {
                console.error('❌ Critical polling error:', error.message);
            } finally {
                this.pollingActive = false;
            }
        }, 3000); // Poll every 3 seconds for faster response

        // Periodic deep scan to catch any missed events
        setInterval(async () => {
            await this.performDeepScan(abi);
        }, 60000); // Deep scan every minute
    }

    private async pollForEvents(abi: any[]): Promise<void> {
        try {
            const currentBlock = await this.client.getBlockNumber();
            
            // Use overlapping ranges to prevent missing events during block reorgs
            const fromBlock = this.lastProcessedBlock > 0n 
                ? this.lastProcessedBlock - 2n  // Overlap by 2 blocks for safety
                : currentBlock - 50n; // Look back only 50 blocks on first run for safety
                
            if (fromBlock <= currentBlock) {
                const logs = await this.client.getContractEvents({
                    address: CONTRACT_ADDRESS,
                    abi: abi,
                    eventName: 'RandomWordsRequested',
                    fromBlock: fromBlock > 0n ? fromBlock : 1n,
                    toBlock: currentBlock
                });

                let newEventsCount = 0;
                for (const log of logs) {
                    const requestKey = `${log.blockNumber}-${log.args.requestId}`;
                    if (!this.processedRequests.has(requestKey)) {
                        console.log(`📡 New event detected: RequestId ${log.args.requestId} in block ${log.blockNumber}`);
                        this.processedRequests.add(requestKey);
                        newEventsCount++;
                        
                        // Process immediately
                        this.handleRandomnessRequest(log, abi).catch(error => {
                            console.error(`Failed to process request ${log.args.requestId}:`, error.message);
                            // Add to failed requests for retry
                            this.failedRequests.set(requestKey, {
                                log,
                                attempts: 0,
                                lastAttempt: Date.now()
                            });
                        });
                    }
                }

                if (newEventsCount > 0) {
                    console.log(`✅ Processed ${newEventsCount} new events in range ${fromBlock}-${currentBlock}`);
                }

                // Update last processed block
                this.lastProcessedBlock = currentBlock;
            }
        } catch (error: any) {
            console.error('❌ Event polling error:', error.message);
            // Don't update lastProcessedBlock on error to retry the same range
        }
    }

    private async retryFailedRequests(abi: any[]): Promise<void> {
        const now = Date.now();
        const retryDelay = 30000; // Wait 30 seconds before retry
        const maxRetries = 5;

        for (const [requestKey, failedRequest] of this.failedRequests.entries()) {
            if (now - failedRequest.lastAttempt < retryDelay) {
                continue; // Too soon to retry
            }

            if (failedRequest.attempts >= maxRetries) {
                console.error(`❌ Request ${requestKey} failed ${maxRetries} times. Removing from retry queue.`);
                this.failedRequests.delete(requestKey);
                continue;
            }

            failedRequest.attempts++;
            failedRequest.lastAttempt = now;

            console.log(`🔄 Retrying failed request ${requestKey} (attempt ${failedRequest.attempts}/${maxRetries})`);
            
            try {
                await this.handleRandomnessRequest(failedRequest.log, abi);
                console.log(`✅ Successfully retried request ${requestKey}`);
                this.failedRequests.delete(requestKey);
            } catch (error: any) {
                console.error(`❌ Retry failed for request ${requestKey}:`, error.message);
            }
        }
    }

    private async performDeepScan(abi: any[]): Promise<void> {
        try {
            console.log("🔍 Performing deep scan for missed events...");
            const currentBlock = await this.client.getBlockNumber();
            const scanFromBlock = currentBlock - 1000n; // Scan last 1000 blocks
            
            const logs = await this.client.getContractEvents({
                address: CONTRACT_ADDRESS,
                abi: abi,
                eventName: 'RandomWordsRequested',
                fromBlock: scanFromBlock > 0n ? scanFromBlock : 1n,
                toBlock: currentBlock
            });

            let missedEvents = 0;
            for (const log of logs) {
                const requestKey = `${log.blockNumber}-${log.args.requestId}`;
                if (!this.processedRequests.has(requestKey)) {
                    console.log(`🚨 Deep scan found missed event: RequestId ${log.args.requestId} in block ${log.blockNumber}`);
                    this.processedRequests.add(requestKey);
                    missedEvents++;
                    
                    // Check if request is too old (block hash unavailable)
                    const blockAge = currentBlock - log.blockNumber;
                    if (blockAge < 240n) { // Process if less than 240 blocks old
                        this.handleRandomnessRequest(log, abi).catch(error => {
                            console.error(`Deep scan processing failed for ${requestKey}:`, error.message);
                        });
                    } else {
                        console.warn(`⚠️ Skipping old request ${requestKey} - block ${blockAge} blocks old`);
                    }
                }
            }

            if (missedEvents > 0) {
                console.log(`🔍 Deep scan completed: Found ${missedEvents} missed events`);
            } else {
                console.log(`✅ Deep scan completed: No missed events found`);
            }
        } catch (error: any) {
            console.error('❌ Deep scan error:', error.message);
        }
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
