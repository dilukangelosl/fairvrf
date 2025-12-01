import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { keccak256, toHex } from "viem";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export class ChainManager {
    chain = [];
    chainPath;
    currentIndex = -1;
    rotationStrategy;
    constructor(rotationStrategy) {
        this.chainPath = path.join(__dirname, "../../server/chain.db.json");
        this.rotationStrategy = {
            enabled: true,
            thresholdPercentage: 80, // Rotate when 80% used
            minRemainingSeeds: 50, // Or when <50 seeds remain
            autoGenerateNewChain: true,
            ...rotationStrategy,
        };
        this.loadChain();
        console.log(`Loaded chain with ${this.chain.length} seeds.`);
        console.log(`Rotation strategy: ${this.rotationStrategy.enabled ? "ENABLED" : "DISABLED"}`);
        if (this.rotationStrategy.enabled) {
            console.log(`  - Threshold: ${this.rotationStrategy.thresholdPercentage}% utilization`);
            console.log(`  - Min remaining: ${this.rotationStrategy.minRemainingSeeds} seeds`);
            console.log(`  - Auto-generate: ${this.rotationStrategy.autoGenerateNewChain ? "YES" : "NO"}`);
        }
    }
    loadChain() {
        if (!fs.existsSync(this.chainPath)) {
            throw new Error(`Chain DB not found at ${this.chainPath}. Run generate-chain.ts first.`);
        }
        this.chain = JSON.parse(fs.readFileSync(this.chainPath, "utf8"));
        this.currentIndex = -1; // Reset index when loading new chain
    }
    /**
     * Finds the next seed to reveal based on the current anchor.
     * Now includes automatic rotation detection and warnings.
     */
    getNextSeed(currentAnchor) {
        const normalizedAnchor = currentAnchor.toLowerCase();
        const index = this.chain.findIndex((seed) => seed.toLowerCase() === normalizedAnchor);
        if (index === -1) {
            throw new Error(`Current anchor ${currentAnchor} not found in local chain DB. Sync issue?`);
        }
        if (index >= this.chain.length - 1) {
            throw new Error("Chain Exhausted! Admin must commit a new anchor.");
        }
        this.currentIndex = index;
        const nextSeed = this.chain[index + 1];
        // Check if rotation is needed
        const stats = this.getChainStats();
        if (stats.shouldRotate) {
            this.handleRotationNeeded(stats);
        }
        return nextSeed;
    }
    /**
     * Get detailed statistics about current chain usage
     */
    getChainStats() {
        const totalSeeds = this.chain.length;
        const currentIndex = this.currentIndex;
        // Fix: When currentIndex is -1 (initial state), we have all seeds remaining
        const remainingSeeds = currentIndex >= 0 ? totalSeeds - currentIndex - 1 : totalSeeds;
        const utilizationPercentage = currentIndex >= 0 ? ((currentIndex + 1) / totalSeeds) * 100 : 0;
        const shouldRotate = this.rotationStrategy.enabled &&
            (utilizationPercentage >= this.rotationStrategy.thresholdPercentage ||
                remainingSeeds <= this.rotationStrategy.minRemainingSeeds);
        return {
            totalSeeds,
            currentIndex,
            remainingSeeds,
            utilizationPercentage,
            shouldRotate,
            rotationThreshold: this.rotationStrategy.thresholdPercentage,
        };
    }
    /**
     * Handle rotation when threshold is reached
     */
    handleRotationNeeded(stats) {
        console.warn(`ROTATION NEEDED! Chain utilization: ${stats.utilizationPercentage.toFixed(1)}%`);
        console.warn(`   Remaining seeds: ${stats.remainingSeeds}/${stats.totalSeeds}`);
        if (this.rotationStrategy.autoGenerateNewChain) {
            console.log(`Auto-generating new hash chain...`);
            this.generateNewChain();
        }
        else {
            console.warn(`Manual intervention required: Generate new chain and update contract anchor!`);
        }
    }
    /**
     * Generate a new hash chain and save it
     */
    generateNewChain(chainLength = 1000) {
        console.log(`Generating new hash chain with ${chainLength} seeds...`);
        // Generate random secret seed
        const randomBytes = new Uint8Array(32);
        crypto.getRandomValues(randomBytes);
        const secret = toHex(randomBytes);
        const newChain = [];
        let current = secret;
        // Build chain backwards (secret -> ... -> s1 -> s0)
        for (let i = 0; i < chainLength; i++) {
            newChain.unshift(current);
            current = keccak256(current);
        }
        // Backup old chain
        const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
        const backupPath = this.chainPath.replace(".json", `_backup_${timestamp}.json`);
        fs.writeFileSync(backupPath, JSON.stringify(this.chain, null, 2));
        console.log(`Backed up old chain to: ${backupPath}`);
        // Save new chain
        fs.writeFileSync(this.chainPath, JSON.stringify(newChain, null, 2));
        console.log(`Saved new chain to: ${this.chainPath}`);
        // Reload chain
        this.loadChain();
        const newAnchor = newChain[0]; // s0 is the anchor
        console.log(`New anchor (s0): ${newAnchor}`);
        console.warn(`IMPORTANT: Update contract anchor to: ${newAnchor}`);
        return newAnchor;
    }
    /**
     * Manual rotation trigger
     */
    rotateChain(chainLength = 1000) {
        return this.generateNewChain(chainLength);
    }
    /**
     * Verify a seed against expected hash
     */
    verifySeed(seed, expectedHash) {
        return keccak256(seed).toLowerCase() === expectedHash.toLowerCase();
    }
    /**
     * Get chain health metrics
     */
    getHealthMetrics() {
        const stats = this.getChainStats();
        let status = "healthy";
        const recommendations = [];
        if (stats.utilizationPercentage >= 90) {
            status = "critical";
            recommendations.push("Immediate chain rotation required");
            recommendations.push("Update contract anchor ASAP");
        }
        else if (stats.utilizationPercentage >= this.rotationStrategy.thresholdPercentage) {
            status = "warning";
            recommendations.push("Chain rotation recommended");
            recommendations.push("Prepare new anchor for contract update");
        }
        // Only mark as critical if we have very few seeds relative to chain size
        if (stats.remainingSeeds <= Math.max(3, Math.floor(stats.totalSeeds * 0.05))) {
            status = "critical";
            recommendations.push(`Less than ${Math.max(3, Math.floor(stats.totalSeeds * 0.05))} seeds remaining - URGENT`);
        }
        return {
            chainLength: stats.totalSeeds,
            currentUtilization: stats.utilizationPercentage,
            estimatedRequestsRemaining: stats.remainingSeeds,
            status,
            recommendations,
        };
    }
    /**
     * Get the current anchor (first element)
     */
    getCurrentAnchor() {
        return this.chain[0];
    }
    /**
     * Get chain segment for testing/verification
     */
    getChainSegment(start, end) {
        return this.chain.slice(start, end);
    }
}
//# sourceMappingURL=chain-manager.js.map