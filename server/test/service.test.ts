import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { keccak256, toHex } from "viem";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("FairVRFService", () => {
  let tempChainPath: string;
  let testChain: string[];
  let service: MockFairVRFService;

  beforeEach(() => {
    // Create a test chain
    const secret = toHex("TEST_SERVICE_SECRET");
    testChain = [];
    let current = secret;

    // Build test chain (20 seeds for service testing)
    for (let i = 0; i < 20; i++) {
      testChain.unshift(current);
      current = keccak256(current as `0x${string}`);
    }

    // Create temp chain file
    tempChainPath = path.join(__dirname, "../chain.service.test.json");
    fs.writeFileSync(tempChainPath, JSON.stringify(testChain, null, 2));

    // Set test environment
    process.env.TEST_MODE = "true";
    process.env.CONTRACT_ADDRESS = "0x1234567890123456789012345678901234567890";
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(tempChainPath)) {
      fs.unlinkSync(tempChainPath);
    }
    
    // Clean up backup files
    const backupPattern = /chain\.service\.test_backup_.*\.json$/;
    const testDir = path.dirname(tempChainPath);
    if (fs.existsSync(testDir)) {
      fs.readdirSync(testDir)
        .filter(file => backupPattern.test(file))
        .forEach(file => {
          fs.unlinkSync(path.join(testDir, file));
        });
    }

    delete process.env.TEST_MODE;
    delete process.env.CONTRACT_ADDRESS;

    if (service) {
      service.stop();
    }
  });

  describe("Service Initialization", () => {
    it("Should initialize with correct default configuration", () => {
      service = new MockFairVRFService(tempChainPath);
      
      const metrics = service.getMetrics();
      expect(metrics.totalRequests).to.equal(0);
      expect(metrics.successfulFulfillments).to.equal(0);
      expect(metrics.failedFulfillments).to.equal(0);
      expect(metrics.averageResponseTime).to.equal(0);
    });

    it("Should load chain manager successfully", () => {
      service = new MockFairVRFService(tempChainPath);
      
      const chainStats = service.getChainStats();
      expect(chainStats.totalSeeds).to.equal(20);
      expect(chainStats.currentIndex).to.equal(-1);
    });

    it("Should report initial health status", () => {
      service = new MockFairVRFService(tempChainPath);
      
      const health = service.getChainHealth();
      expect(health.status).to.equal("healthy");
      expect(health.chainLength).to.equal(20);
    });
  });

  describe("Request Processing", () => {
    it("Should process randomness request successfully", async () => {
      service = new MockFairVRFService(tempChainPath);
      
      // Simulate a randomness request
      const mockLog = {
        args: {
          requestId: 1n,
          minimumRequestConfirmations: 3
        },
        blockNumber: 100n
      };

      const result = await service.simulateHandleRequest(mockLog, testChain[0]);
      
      expect(result.success).to.be.true;
      expect(result.nextSeed).to.equal(testChain[1]);
      
      const metrics = service.getMetrics();
      expect(metrics.totalRequests).to.equal(1);
      expect(metrics.successfulFulfillments).to.equal(1);
    });

    it("Should handle multiple sequential requests", async () => {
      service = new MockFairVRFService(tempChainPath);
      
      // Process 5 requests sequentially
      for (let i = 0; i < 5; i++) {
        const mockLog = {
          args: {
            requestId: BigInt(i + 1),
            minimumRequestConfirmations: 3
          },
          blockNumber: BigInt(100 + i)
        };

        const result = await service.simulateHandleRequest(mockLog, testChain[i]);
        expect(result.success).to.be.true;
      }
      
      const metrics = service.getMetrics();
      expect(metrics.totalRequests).to.equal(5);
      expect(metrics.successfulFulfillments).to.equal(5);
      expect(metrics.failedFulfillments).to.equal(0);

      const chainStats = service.getChainStats();
      expect(chainStats.currentIndex).to.equal(4); // Last used index
      expect(chainStats.utilizationPercentage).to.equal(25); // 5/20 * 100
    });

    it("Should track response times accurately", async () => {
      service = new MockFairVRFService(tempChainPath);
      
      const mockLog = {
        args: {
          requestId: 1n,
          minimumRequestConfirmations: 3
        },
        blockNumber: 100n
      };

      // Simulate processing with delay
      const startTime = Date.now();
      await service.simulateHandleRequest(mockLog, testChain[0], 50); // 50ms delay
      const actualDuration = Date.now() - startTime;
      
      const metrics = service.getMetrics();
      expect(metrics.averageResponseTime).to.be.greaterThan(40);
      expect(metrics.averageResponseTime).to.be.lessThan(actualDuration + 20);
    });
  });

  describe("Error Handling", () => {
    it("Should handle invalid anchor gracefully", async () => {
      service = new MockFairVRFService(tempChainPath);
      
      const mockLog = {
        args: {
          requestId: 1n,
          minimumRequestConfirmations: 3
        },
        blockNumber: 100n
      };

      const result = await service.simulateHandleRequest(mockLog, "0x1234invalid");
      
      expect(result.success).to.be.false;
      expect(result.error).to.include("not found in local chain DB");
      
      const metrics = service.getMetrics();
      expect(metrics.totalRequests).to.equal(1);
      expect(metrics.failedFulfillments).to.equal(1);
    });

    it("Should handle chain exhaustion", async () => {
      service = new MockFairVRFService(tempChainPath);
      
      const mockLog = {
        args: {
          requestId: 1n,
          minimumRequestConfirmations: 3
        },
        blockNumber: 100n
      };

      // Try to process from last seed (should fail)
      const lastSeed = testChain[testChain.length - 1];
      const result = await service.simulateHandleRequest(mockLog, lastSeed);
      
      expect(result.success).to.be.false;
      expect(result.error).to.include("Chain Exhausted");
    });

    it("Should handle network errors gracefully", async () => {
      service = new MockFairVRFService(tempChainPath);
      
      // Simulate network error
      service.setSimulateNetworkError(true);
      
      const mockLog = {
        args: {
          requestId: 1n,
          minimumRequestConfirmations: 3
        },
        blockNumber: 100n
      };

      const result = await service.simulateHandleRequest(mockLog, testChain[0]);
      
      expect(result.success).to.be.false;
      expect(result.error).to.include("Network error");
    });
  });

  describe("Chain Rotation Integration", () => {
    it("Should detect when rotation is needed", async () => {
      service = new MockFairVRFService(tempChainPath, {
        enabled: true,
        thresholdPercentage: 50,
        minRemainingSeeds: 5,
        autoGenerateNewChain: false // Don't auto-rotate for testing
      });
      
      // Process enough requests to trigger rotation warning
      for (let i = 0; i < 10; i++) {
        const mockLog = {
          args: {
            requestId: BigInt(i + 1),
            minimumRequestConfirmations: 3
          },
          blockNumber: BigInt(100 + i)
        };

        await service.simulateHandleRequest(mockLog, testChain[i]);
      }
      
      const chainStats = service.getChainStats();
      expect(chainStats.shouldRotate).to.be.true;
      expect(chainStats.utilizationPercentage).to.be.greaterThanOrEqual(50);
    });

    it("Should perform manual chain rotation", async () => {
      service = new MockFairVRFService(tempChainPath);
      
      const originalAnchor = service.getCurrentAnchor();
      const newAnchor = await service.rotateChain(10);
      
      expect(newAnchor).to.not.equal(originalAnchor);
      
      const chainStats = service.getChainStats();
      expect(chainStats.totalSeeds).to.equal(10);
      expect(chainStats.currentIndex).to.equal(-1); // Reset after rotation
    });

    it("Should continue processing after rotation", async () => {
      service = new MockFairVRFService(tempChainPath);
      
      // Process some requests
      const mockLog1 = {
        args: { requestId: 1n, minimumRequestConfirmations: 3 },
        blockNumber: 100n
      };
      await service.simulateHandleRequest(mockLog1, testChain[0]);
      
      // Rotate chain
      const newAnchor = await service.rotateChain(15);
      
      // Process request with new chain
      const mockLog2 = {
        args: { requestId: 2n, minimumRequestConfirmations: 3 },
        blockNumber: 101n
      };
      
      const result = await service.simulateHandleRequest(mockLog2, newAnchor);
      expect(result.success).to.be.true;
      
      const metrics = service.getMetrics();
      expect(metrics.successfulFulfillments).to.equal(2);
    });
  });

  describe("Health Monitoring", () => {
    it("Should track uptime correctly", async () => {
      service = new MockFairVRFService(tempChainPath);
      
      const initialMetrics = service.getMetrics();
      const initialUptime = initialMetrics.uptime;
      
      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const laterMetrics = service.getMetrics();
      expect(laterMetrics.uptime).to.be.greaterThan(initialUptime);
    });

    it("Should update health status based on chain usage", async () => {
      service = new MockFairVRFService(tempChainPath, {
        enabled: true,
        thresholdPercentage: 30,
        minRemainingSeeds: 10
      });
      
      // Initially healthy
      let health = service.getChainHealth();
      expect(health.status).to.equal("healthy");
      
      // Process requests to reach warning threshold
      for (let i = 0; i < 6; i++) {
        const mockLog = {
          args: { requestId: BigInt(i + 1), minimumRequestConfirmations: 3 },
          blockNumber: BigInt(100 + i)
        };
        await service.simulateHandleRequest(mockLog, testChain[i]);
      }
      
      health = service.getChainHealth();
      expect(health.status).to.equal("warning");
      expect(health.recommendations.length).to.be.greaterThan(0);
    });
  });

  describe("Performance Testing", () => {
    it("Should handle high request volume", async () => {
      service = new MockFairVRFService(tempChainPath);
      
      const startTime = Date.now();
      const promises = [];
      
      // Simulate 10 concurrent requests with minimal delay to ensure measurable response time
      for (let i = 0; i < 10; i++) {
        const mockLog = {
          args: { requestId: BigInt(i + 1), minimumRequestConfirmations: 3 },
          blockNumber: BigInt(100 + i)
        };
        
        promises.push(service.simulateHandleRequest(mockLog, testChain[i], 1)); // 1ms delay
      }
      
      const results = await Promise.all(promises);
      const endTime = Date.now();
      
      // All should succeed
      results.forEach(result => expect(result.success).to.be.true);
      
      // Should complete reasonably quickly
      const totalTime = endTime - startTime;
      expect(totalTime).to.be.lessThan(1000); // Less than 1 second
      
      const metrics = service.getMetrics();
      expect(metrics.totalRequests).to.equal(10);
      expect(metrics.averageResponseTime).to.be.greaterThan(0);
    });

    it("Should maintain performance with chain near exhaustion", async () => {
      service = new MockFairVRFService(tempChainPath);
      
      // Process requests near the end of the chain
      const nearEndIndex = testChain.length - 5;
      
      const startTime = Date.now();
      for (let i = 0; i < 3; i++) {
        const mockLog = {
          args: { requestId: BigInt(i + 1), minimumRequestConfirmations: 3 },
          blockNumber: BigInt(200 + i)
        };
        
        const result = await service.simulateHandleRequest(mockLog, testChain[nearEndIndex + i]);
        expect(result.success).to.be.true;
      }
      const endTime = Date.now();
      
      // Should still be fast even near exhaustion
      const avgTimePerRequest = (endTime - startTime) / 3;
      expect(avgTimePerRequest).to.be.lessThan(50);
    });
  });

  describe("Integration Testing", () => {
    it("Should integrate all components correctly", async () => {
      service = new MockFairVRFService(tempChainPath, {
        enabled: true,
        thresholdPercentage: 40,
        minRemainingSeeds: 5,
        autoGenerateNewChain: false
      });
      
      // Simulate a complete workflow
      const workflow = [];
      
      // 1. Process normal requests
      for (let i = 0; i < 5; i++) {
        const mockLog = {
          args: { requestId: BigInt(i + 1), minimumRequestConfirmations: 3 },
          blockNumber: BigInt(100 + i)
        };
        
        const result = await service.simulateHandleRequest(mockLog, testChain[i]);
        workflow.push({ step: `Request ${i + 1}`, success: result.success });
      }
      
      // 2. Check health
      const health = service.getChainHealth();
      workflow.push({ step: "Health check", status: health.status });
      
      // 3. Continue until rotation needed
      for (let i = 5; i < 8; i++) {
        const mockLog = {
          args: { requestId: BigInt(i + 1), minimumRequestConfirmations: 3 },
          blockNumber: BigInt(100 + i)
        };
        
        await service.simulateHandleRequest(mockLog, testChain[i]);
      }
      
      // 4. Check if rotation is needed
      const stats = service.getChainStats();
      workflow.push({ step: "Rotation check", shouldRotate: stats.shouldRotate });
      
      // 5. Perform rotation if needed
      if (stats.shouldRotate) {
        const newAnchor = await service.rotateChain(25);
        workflow.push({ step: "Chain rotation", newAnchor: !!newAnchor });
      }
      
      // 6. Continue processing with new chain
      const finalLog = {
        args: { requestId: 999n, minimumRequestConfirmations: 3 },
        blockNumber: 999n
      };
      
      const finalResult = await service.simulateHandleRequest(
        finalLog, 
        service.getCurrentAnchor()
      );
      workflow.push({ step: "Post-rotation request", success: finalResult.success });
      
      // Verify complete workflow
      const metrics = service.getMetrics();
      expect(metrics.totalRequests).to.be.greaterThan(8);
      expect(metrics.successfulFulfillments).to.be.greaterThan(8);
      expect(workflow.every(step => 
        step.success !== false && 
        step.newAnchor !== false
      )).to.be.true;
    });
  });
});

// Mock service class for testing
class MockFairVRFService {
  private chainPath: string;
  private rotationStrategy: any;
  private simulateNetworkError: boolean = false;
  private chainManager: TestChainManager;
  private startTime: Date;
  private metrics: {
    totalRequests: number;
    successfulFulfillments: number;
    failedFulfillments: number;
    averageResponseTime: number;
    uptime: number;
    lastHealthCheck: Date;
  };

  constructor(chainPath: string, rotationStrategy?: any) {
    this.chainPath = chainPath;
    this.rotationStrategy = rotationStrategy;
    
    // Initialize components
    this.chainManager = new TestChainManager(
      this.rotationStrategy || { enabled: false }, 
      this.chainPath
    );
    
    this.startTime = new Date();
    this.metrics = {
      totalRequests: 0,
      successfulFulfillments: 0,
      failedFulfillments: 0,
      averageResponseTime: 0,
      uptime: 0,
      lastHealthCheck: new Date()
    };
  }

  // Mock FairVRFService interface methods
  public getMetrics() {
    const now = new Date();
    this.metrics.uptime = now.getTime() - this.startTime.getTime();
    this.metrics.lastHealthCheck = now;
    return { ...this.metrics };
  }

  public getChainHealth() {
    return this.chainManager.getHealthMetrics();
  }

  public getChainStats() {
    return this.chainManager.getChainStats();
  }

  public async rotateChain(chainLength?: number): Promise<string> {
    return this.chainManager.rotateChain(chainLength);
  }

  // Expose simulation methods for testing
  async simulateHandleRequest(log: any, currentAnchor: string, delay: number = 0): Promise<{
    success: boolean;
    nextSeed?: string;
    error?: string;
    responseTime?: number;
  }> {
    const startTime = Date.now();
    
    try {
      if (this.simulateNetworkError) {
        throw new Error("Network error simulated");
      }
      
      // Simulate processing delay
      if (delay > 0) {
        await new Promise(resolve => setTimeout(resolve, delay));
      }
      
      this.metrics.totalRequests++;
      
      const nextSeed = this.chainManager.getNextSeed(currentAnchor);
      
      const responseTime = Date.now() - startTime;
      this.metrics.successfulFulfillments++;
      this.updateAverageResponseTime(responseTime);
      
      return { 
        success: true, 
        nextSeed,
        responseTime 
      };
      
    } catch (error: any) {
      this.metrics.failedFulfillments++;
      return { 
        success: false, 
        error: error.message 
      };
    }
  }

  private updateAverageResponseTime(responseTime: number): void {
    // Fix: Calculate average properly, accounting for the new fulfillment count
    const previousTotal = this.metrics.averageResponseTime * (this.metrics.successfulFulfillments - 1);
    this.metrics.averageResponseTime = (previousTotal + responseTime) / this.metrics.successfulFulfillments;
  }

  getCurrentAnchor(): string {
    return this.chainManager.getCurrentAnchor();
  }

  setSimulateNetworkError(simulate: boolean): void {
    this.simulateNetworkError = simulate;
  }

  stop(): void {
    // Cleanup method for tests
  }
}

// Test helper class that allows custom chain path
class TestChainManager {
  private chain: string[] = [];
  private chainPath: string;
  private currentIndex: number = -1;
  private rotationStrategy: any;

  constructor(rotationStrategy: any, chainPath: string) {
    this.chainPath = chainPath;
    this.rotationStrategy = rotationStrategy;
    this.loadChain();
  }

  private loadChain(): void {
    if (!fs.existsSync(this.chainPath)) {
      throw new Error(`Chain DB not found at ${this.chainPath}`);
    }
    this.chain = JSON.parse(fs.readFileSync(this.chainPath, "utf8"));
    this.currentIndex = -1;
  }

  getNextSeed(currentAnchor: string): string {
    const normalizedAnchor = currentAnchor.toLowerCase();
    const index = this.chain.findIndex(seed => seed.toLowerCase() === normalizedAnchor);
    
    if (index === -1) {
      throw new Error(`Current anchor ${currentAnchor} not found in local chain DB. Sync issue?`);
    }

    if (index >= this.chain.length - 1) {
      throw new Error("Chain Exhausted! Admin must commit a new anchor.");
    }

    this.currentIndex = index;
    return this.chain[index + 1];
  }

  getChainStats() {
    const totalSeeds = this.chain.length;
    const currentIndex = this.currentIndex;
    const remainingSeeds = totalSeeds - currentIndex - 1;
    const utilizationPercentage = currentIndex >= 0 ? ((currentIndex + 1) / totalSeeds) * 100 : 0;
    
    const shouldRotate = this.rotationStrategy?.enabled && (
      utilizationPercentage >= (this.rotationStrategy.thresholdPercentage || 80) ||
      remainingSeeds <= (this.rotationStrategy.minRemainingSeeds || 50)
    );

    return {
      totalSeeds,
      currentIndex,
      remainingSeeds,
      utilizationPercentage,
      shouldRotate,
      rotationThreshold: this.rotationStrategy?.thresholdPercentage || 80
    };
  }

  getHealthMetrics() {
    const stats = this.getChainStats();
    let status: "healthy" | "warning" | "critical" = "healthy";
    const recommendations: string[] = [];
    
    if (stats.utilizationPercentage >= 90) {
      status = "critical";
      recommendations.push("Immediate chain rotation required");
    } else if (stats.utilizationPercentage >= (this.rotationStrategy?.thresholdPercentage || 80)) {
      status = "warning";
      recommendations.push("Chain rotation recommended");
    }

    return {
      chainLength: stats.totalSeeds,
      currentUtilization: stats.utilizationPercentage,
      estimatedRequestsRemaining: stats.remainingSeeds,
      status,
      recommendations
    };
  }

  getCurrentAnchor(): string {
    return this.chain[0];
  }

  rotateChain(chainLength: number = 10): string {
    // Generate new test chain
    const newChain: string[] = [];
    const randomBytes = new Uint8Array(32);
    crypto.getRandomValues(randomBytes);
    let current = toHex(randomBytes);
    
    for (let i = 0; i < chainLength; i++) {
      newChain.unshift(current);
      current = keccak256(current as `0x${string}`);
    }
    
    // Backup old chain
    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = this.chainPath.replace(".json", `_backup_${timestamp}.json`);
    fs.writeFileSync(backupPath, JSON.stringify(this.chain, null, 2));
    
    // Save new chain
    fs.writeFileSync(this.chainPath, JSON.stringify(newChain, null, 2));
    
    // Reload
    this.loadChain();
    
    return newChain[0];
  }
}
