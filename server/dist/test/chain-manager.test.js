import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { keccak256, toHex } from "viem";
import { ChainManager } from "../src/chain-manager.js";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
describe("ChainManager", () => {
    let tempChainPath;
    let testChain;
    let chainManager;
    beforeEach(() => {
        // Create a test chain
        const secret = toHex("TEST_SECRET_SEED");
        testChain = [];
        let current = secret;
        // Build small test chain (10 seeds)
        for (let i = 0; i < 10; i++) {
            testChain.unshift(current);
            current = keccak256(current);
        }
        // Create temp chain file
        tempChainPath = path.join(__dirname, "../chain.test.json");
        fs.writeFileSync(tempChainPath, JSON.stringify(testChain, null, 2));
        // Mock the chain path in ChainManager
        process.env.TEST_MODE = "true";
    });
    afterEach(() => {
        // Cleanup
        if (fs.existsSync(tempChainPath)) {
            fs.unlinkSync(tempChainPath);
        }
        // Clean up backup files
        const backupPattern = /chain\.test_backup_.*\.json$/;
        const testDir = path.dirname(tempChainPath);
        fs.readdirSync(testDir)
            .filter(file => backupPattern.test(file))
            .forEach(file => {
            fs.unlinkSync(path.join(testDir, file));
        });
        delete process.env.TEST_MODE;
    });
    describe("Basic Functionality", () => {
        it("Should load chain successfully", () => {
            chainManager = new TestChainManager({ enabled: false }, tempChainPath);
            expect(chainManager.getCurrentAnchor()).to.equal(testChain[0]);
        });
        it("Should get next seed correctly", () => {
            chainManager = new TestChainManager({ enabled: false }, tempChainPath);
            const anchor = testChain[0]; // s0
            const expectedNext = testChain[1]; // s1
            const nextSeed = chainManager.getNextSeed(anchor);
            expect(nextSeed).to.equal(expectedNext);
        });
        it("Should verify seeds correctly", () => {
            chainManager = new TestChainManager({ enabled: false }, tempChainPath);
            // Test valid verification
            const seed = testChain[1]; // s1
            const expectedHash = testChain[0]; // s0 = keccak256(s1)
            expect(chainManager.verifySeed(seed, expectedHash)).to.be.true;
            // Test invalid verification
            expect(chainManager.verifySeed("0x1234", expectedHash)).to.be.false;
        });
        it("Should get chain segment correctly", () => {
            chainManager = new TestChainManager({ enabled: false }, tempChainPath);
            const segment = chainManager.getChainSegment(0, 3);
            expect(segment).to.deep.equal([testChain[0], testChain[1], testChain[2]]);
        });
    });
    describe("Chain Statistics", () => {
        it("Should calculate stats correctly at start", () => {
            chainManager = new TestChainManager({ enabled: false }, tempChainPath);
            const stats = chainManager.getChainStats();
            expect(stats.totalSeeds).to.equal(10);
            expect(stats.currentIndex).to.equal(-1);
            expect(stats.remainingSeeds).to.equal(10); // totalSeeds when currentIndex is -1 (initial state)
            expect(stats.utilizationPercentage).to.equal(0);
            expect(stats.shouldRotate).to.be.false;
        });
        it("Should update stats after usage", () => {
            chainManager = new TestChainManager({
                enabled: true,
                thresholdPercentage: 50,
                minRemainingSeeds: 5
            }, tempChainPath);
            // Use several seeds
            chainManager.getNextSeed(testChain[0]); // Move to index 0
            chainManager.getNextSeed(testChain[1]); // Move to index 1
            chainManager.getNextSeed(testChain[2]); // Move to index 2
            const stats = chainManager.getChainStats();
            expect(stats.currentIndex).to.equal(2);
            expect(stats.utilizationPercentage).to.equal(30); // (2+1)/10 * 100
            expect(stats.remainingSeeds).to.equal(7);
        });
    });
    describe("Health Monitoring", () => {
        it("Should report healthy status initially", () => {
            chainManager = new TestChainManager({ enabled: false }, tempChainPath);
            const health = chainManager.getHealthMetrics();
            expect(health.status).to.equal("healthy");
            expect(health.chainLength).to.equal(10);
            expect(health.currentUtilization).to.equal(0);
            expect(health.recommendations).to.be.empty;
        });
        it("Should report warning when threshold reached", () => {
            chainManager = new TestChainManager({
                enabled: true,
                thresholdPercentage: 50,
                minRemainingSeeds: 2,
                autoGenerateNewChain: false // Disable auto-rotation for this test
            }, tempChainPath);
            // Use 5+ seeds to reach 50% threshold
            for (let i = 0; i < 5; i++) {
                chainManager.getNextSeed(testChain[i]);
            }
            const health = chainManager.getHealthMetrics();
            expect(health.status).to.equal("warning");
            expect(health.recommendations).to.include("Chain rotation recommended");
        });
        it("Should report critical when near exhaustion", () => {
            chainManager = new TestChainManager({
                enabled: true,
                thresholdPercentage: 90,
                minRemainingSeeds: 3,
                autoGenerateNewChain: false // Disable auto-rotation for this test
            }, tempChainPath);
            // Use most of the chain (7 out of 10, leaving 2 remaining)
            for (let i = 0; i < 7; i++) {
                chainManager.getNextSeed(testChain[i]);
            }
            const health = chainManager.getHealthMetrics();
            expect(health.status).to.equal("critical");
            expect(health.recommendations.length).to.be.greaterThan(0);
        });
    });
    describe("Rotation Strategy", () => {
        it("Should trigger rotation at threshold", () => {
            chainManager = new TestChainManager({
                enabled: true,
                thresholdPercentage: 50,
                minRemainingSeeds: 2,
                autoGenerateNewChain: false // Don't auto-generate for testing
            }, tempChainPath);
            // Use enough seeds to trigger rotation
            for (let i = 0; i < 5; i++) {
                chainManager.getNextSeed(testChain[i]);
            }
            const stats = chainManager.getChainStats();
            expect(stats.shouldRotate).to.be.true;
        });
        it("Should manually rotate chain", () => {
            chainManager = new TestChainManager({ enabled: false }, tempChainPath);
            const originalAnchor = chainManager.getCurrentAnchor();
            const newAnchor = chainManager.rotateChain(5); // Small chain for testing
            expect(newAnchor).to.not.equal(originalAnchor);
            expect(chainManager.getCurrentAnchor()).to.equal(newAnchor);
            // Verify new chain has correct length
            const newSegment = chainManager.getChainSegment(0, 5);
            expect(newSegment.length).to.equal(5);
        });
        it("Should backup old chain during rotation", () => {
            chainManager = new TestChainManager({ enabled: false }, tempChainPath);
            chainManager.rotateChain(3);
            // Check that backup was created
            const testDir = path.dirname(tempChainPath);
            const backupFiles = fs.readdirSync(testDir)
                .filter(file => file.includes("backup"));
            expect(backupFiles.length).to.be.greaterThan(0);
        });
    });
    describe("Error Handling", () => {
        it("Should throw error for invalid anchor", () => {
            chainManager = new TestChainManager({ enabled: false }, tempChainPath);
            expect(() => {
                chainManager.getNextSeed("0x1234invalid");
            }).to.throw("not found in local chain DB");
        });
        it("Should throw error when chain exhausted", () => {
            chainManager = new TestChainManager({ enabled: false }, tempChainPath);
            // Try to get seed after last element
            const lastSeed = testChain[testChain.length - 1];
            expect(() => {
                chainManager.getNextSeed(lastSeed);
            }).to.throw("Chain Exhausted");
        });
        it("Should handle missing chain file gracefully", () => {
            const invalidPath = "/nonexistent/chain.json";
            expect(() => {
                new TestChainManager({ enabled: false }, invalidPath);
            }).to.throw("Chain DB not found");
        });
    });
    describe("Cryptographic Verification", () => {
        it("Should maintain hash chain integrity", () => {
            chainManager = new TestChainManager({ enabled: false }, tempChainPath);
            // Verify entire chain
            for (let i = 0; i < testChain.length - 1; i++) {
                const current = testChain[i];
                const next = testChain[i + 1];
                const expectedHash = keccak256(next);
                expect(current.toLowerCase()).to.equal(expectedHash.toLowerCase());
            }
        });
        it("Should generate valid new chains", () => {
            chainManager = new TestChainManager({ enabled: false }, tempChainPath);
            chainManager.rotateChain(5);
            const newChain = chainManager.getChainSegment(0, 5);
            // Verify new chain integrity
            for (let i = 0; i < newChain.length - 1; i++) {
                const current = newChain[i];
                const next = newChain[i + 1];
                const expectedHash = keccak256(next);
                expect(current.toLowerCase()).to.equal(expectedHash.toLowerCase());
            }
        });
    });
    describe("Performance", () => {
        it("Should handle rapid sequential requests", () => {
            chainManager = new TestChainManager({ enabled: false }, tempChainPath);
            const startTime = Date.now();
            // Make rapid requests
            for (let i = 0; i < 5; i++) {
                const nextSeed = chainManager.getNextSeed(testChain[i]);
                expect(nextSeed).to.equal(testChain[i + 1]);
            }
            const endTime = Date.now();
            const duration = endTime - startTime;
            // Should complete quickly (< 100ms for 5 requests)
            expect(duration).to.be.lessThan(100);
        });
        it("Should efficiently search large chains", () => {
            // Create larger test chain
            const largeChain = [];
            let current = toHex("LARGE_CHAIN_SECRET");
            for (let i = 0; i < 100; i++) {
                largeChain.unshift(current);
                current = keccak256(current);
            }
            const largePath = path.join(__dirname, "../chain.large.test.json");
            fs.writeFileSync(largePath, JSON.stringify(largeChain, null, 2));
            try {
                chainManager = new TestChainManager({ enabled: false }, largePath);
                const startTime = Date.now();
                const nextSeed = chainManager.getNextSeed(largeChain[0]);
                const endTime = Date.now();
                expect(nextSeed).to.equal(largeChain[1]);
                expect(endTime - startTime).to.be.lessThan(50); // Should be very fast
            }
            finally {
                fs.unlinkSync(largePath);
            }
        });
    });
});
// Test helper class that allows custom chain path
class TestChainManager extends ChainManager {
    constructor(rotationStrategy, chainPath) {
        super(rotationStrategy);
        // Override the chainPath
        this.chainPath = chainPath;
        this.loadChain();
    }
}
//# sourceMappingURL=chain-manager.test.js.map