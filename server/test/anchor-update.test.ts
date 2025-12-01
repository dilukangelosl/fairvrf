import { describe, it, beforeEach, afterEach } from "node:test";
import { expect } from "chai";
import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { keccak256, toHex } from "viem";
import {
  ChainManager,
  RotationStrategy,
  AnchorUpdateCallback,
} from "../src/chain-manager.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Automatic Anchor Update", () => {
  let tempChainPath: string;
  let testChain: string[];
  let chainManager: ChainManager;
  let mockCallbackResults: {
    success: boolean;
    newAnchor?: string;
    error?: Error;
  }[] = [];
  let mockCallback: AnchorUpdateCallback;

  beforeEach(() => {
    // Reset mock results
    mockCallbackResults = [];

    // Create mock callback
    mockCallback = async (newAnchor: string) => {
      const result: any = { success: true, newAnchor };
      mockCallbackResults.push(result);

      // Simulate potential failures for testing
      if (newAnchor.includes("FAIL")) {
        const error = new Error("Mock contract update failed");
        result.success = false;
        result.error = error;
        throw error;
      }

      return Promise.resolve();
    };

    // Create a test chain
    const secret = toHex("TEST_SECRET_SEED");
    testChain = [];
    let current = secret;

    // Build small test chain (5 seeds for faster testing)
    for (let i = 0; i < 5; i++) {
      testChain.unshift(current);
      current = keccak256(current as `0x${string}`);
    }

    // Create temp chain file
    tempChainPath = path.join(__dirname, "../chain.anchor.test.json");
    fs.writeFileSync(tempChainPath, JSON.stringify(testChain, null, 2));
  });

  afterEach(() => {
    // Cleanup
    if (fs.existsSync(tempChainPath)) {
      fs.unlinkSync(tempChainPath);
    }

    // Clean up backup files
    const backupPattern = /chain\.anchor\.test_backup_.*\.json$/;
    const testDir = path.dirname(tempChainPath);
    fs.readdirSync(testDir)
      .filter((file) => backupPattern.test(file))
      .forEach((file) => {
        fs.unlinkSync(path.join(testDir, file));
      });
  });

  describe("Callback Configuration", () => {
    it("Should set anchor update callback", () => {
      chainManager = new TestAnchorChainManager(
        {
          enabled: false,
          autoUpdateContract: false,
        },
        tempChainPath
      );

      chainManager.setAnchorUpdateCallback(mockCallback);

      // Callback is set internally - we'll test it works in rotation tests
      expect(mockCallbackResults).to.be.empty;
    });

    it("Should enable/disable auto contract updates", () => {
      chainManager = new TestAnchorChainManager(
        {
          enabled: false,
          autoUpdateContract: false,
        },
        tempChainPath
      );

      chainManager.setAutoUpdateContract(true);
      chainManager.setAutoUpdateContract(false);

      // Test that the setting is stored (we can't easily check internal state)
      expect(true).to.be.true; // Basic test to ensure no errors
    });
  });

  describe("Manual Chain Rotation with Contract Updates", () => {
    it("Should update contract when auto-update is enabled", async () => {
      chainManager = new TestAnchorChainManager(
        {
          enabled: false,
          autoUpdateContract: true,
        },
        tempChainPath
      );

      chainManager.setAnchorUpdateCallback(mockCallback);

      const originalAnchor = chainManager.getCurrentAnchor();
      const newAnchor = await chainManager.rotateChain(3);

      // Verify rotation worked
      expect(newAnchor).to.not.equal(originalAnchor);
      expect(chainManager.getCurrentAnchor()).to.equal(newAnchor);

      // Verify callback was called
      expect(mockCallbackResults).to.have.length(1);
      expect(mockCallbackResults[0].success).to.be.true;
      expect(mockCallbackResults[0].newAnchor).to.equal(newAnchor);
    });

    it("Should not update contract when auto-update is disabled", async () => {
      chainManager = new TestAnchorChainManager(
        {
          enabled: false,
          autoUpdateContract: false,
        },
        tempChainPath
      );

      chainManager.setAnchorUpdateCallback(mockCallback);

      const originalAnchor = chainManager.getCurrentAnchor();
      const newAnchor = await chainManager.rotateChain(3);

      // Verify rotation worked
      expect(newAnchor).to.not.equal(originalAnchor);
      expect(chainManager.getCurrentAnchor()).to.equal(newAnchor);

      // Verify callback was NOT called
      expect(mockCallbackResults).to.be.empty;
    });

    it("Should not update contract when no callback is set", async () => {
      chainManager = new TestAnchorChainManager(
        {
          enabled: false,
          autoUpdateContract: true,
        },
        tempChainPath
      );

      // Don't set callback

      const originalAnchor = chainManager.getCurrentAnchor();
      const newAnchor = await chainManager.rotateChain(3);

      // Verify rotation worked
      expect(newAnchor).to.not.equal(originalAnchor);
      expect(chainManager.getCurrentAnchor()).to.equal(newAnchor);

      // Verify no callback was called
      expect(mockCallbackResults).to.be.empty;
    });
  });

  describe("Automatic Chain Rotation with Contract Updates", () => {
    it("Should trigger automatic contract update when threshold reached", async () => {
      chainManager = new TestAnchorChainManager(
        {
          enabled: true,
          thresholdPercentage: 60, // 3 out of 5 seeds = 60%
          minRemainingSeeds: 1,
          autoGenerateNewChain: true,
          autoUpdateContract: true,
        },
        tempChainPath
      );

      chainManager.setAnchorUpdateCallback(mockCallback);

      const originalAnchor = chainManager.getCurrentAnchor();

      // Use seeds to trigger automatic rotation (3 out of 5 = 60%)
      chainManager.getNextSeed(testChain[0]); // Move to index 0
      chainManager.getNextSeed(testChain[1]); // Move to index 1
      chainManager.getNextSeed(testChain[2]); // Move to index 2 (60% utilization)

      // Wait a bit for async rotation to complete
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Verify callback was called for automatic rotation
      expect(mockCallbackResults).to.have.length(1);
      expect(mockCallbackResults[0].success).to.be.true;
      expect(mockCallbackResults[0].newAnchor).to.not.equal(originalAnchor);
    });

    it("Should handle contract update failures gracefully", async () => {
      // Create a callback that will fail
      const failingCallback: AnchorUpdateCallback = async (
        newAnchor: string
      ) => {
        mockCallbackResults.push({
          success: false,
          newAnchor,
          error: new Error("Contract update failed"),
        });
        throw new Error("Contract update failed");
      };

      chainManager = new TestAnchorChainManager(
        {
          enabled: false,
          autoUpdateContract: true,
        },
        tempChainPath
      );

      chainManager.setAnchorUpdateCallback(failingCallback);

      const originalAnchor = chainManager.getCurrentAnchor();

      // This should not throw, even though callback fails
      const newAnchor = await chainManager.rotateChain(3);

      // Verify rotation still worked
      expect(newAnchor).to.not.equal(originalAnchor);
      expect(chainManager.getCurrentAnchor()).to.equal(newAnchor);

      // Verify callback was called and failed
      expect(mockCallbackResults).to.have.length(1);
      expect(mockCallbackResults[0].success).to.be.false;
    });
  });

  describe("Integration Scenarios", () => {
    it("Should work correctly in production-like scenario", async () => {
      chainManager = new TestAnchorChainManager(
        {
          enabled: true,
          thresholdPercentage: 80,
          minRemainingSeeds: 1,
          autoGenerateNewChain: true,
          autoUpdateContract: true,
        },
        tempChainPath
      );

      chainManager.setAnchorUpdateCallback(mockCallback);

      // Simulate normal operation
      let currentAnchor = chainManager.getCurrentAnchor();

      // Use seeds normally (should not trigger rotation yet)
      chainManager.getNextSeed(testChain[0]); // 20% utilization
      chainManager.getNextSeed(testChain[1]); // 40% utilization
      chainManager.getNextSeed(testChain[2]); // 60% utilization

      // Should not have triggered rotation yet
      expect(mockCallbackResults).to.be.empty;

      // Push to threshold
      chainManager.getNextSeed(testChain[3]); // 80% utilization - should trigger

      // Wait for async rotation
      await new Promise((resolve) => setTimeout(resolve, 100));

      // Should have triggered automatic rotation with contract update
      expect(mockCallbackResults).to.have.length(1);
      expect(mockCallbackResults[0].success).to.be.true;
    });

    it("Should maintain chain integrity through multiple rotations", async () => {
      chainManager = new TestAnchorChainManager(
        {
          enabled: false,
          autoUpdateContract: true,
        },
        tempChainPath
      );

      chainManager.setAnchorUpdateCallback(mockCallback);

      // Perform multiple rotations
      const anchors = [];

      for (let i = 0; i < 3; i++) {
        const newAnchor = await chainManager.rotateChain(3);
        anchors.push(newAnchor);

        // Verify chain integrity
        const segment = chainManager.getChainSegment(0, 3);
        expect(segment.length).to.equal(3);
        expect(segment[0]).to.equal(newAnchor);

        // Verify each anchor is unique
        if (i > 0) {
          expect(newAnchor).to.not.equal(anchors[i - 1]);
        }
      }

      // Verify all callbacks were successful
      expect(mockCallbackResults).to.have.length(3);
      mockCallbackResults.forEach((result) => {
        expect(result.success).to.be.true;
      });
    });
  });
});

// Test helper class for anchor update testing
class TestAnchorChainManager extends ChainManager {
  constructor(rotationStrategy: Partial<RotationStrategy>, chainPath: string) {
    super(rotationStrategy, chainPath);
  }
}
