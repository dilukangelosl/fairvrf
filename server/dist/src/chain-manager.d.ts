export interface ChainStats {
    totalSeeds: number;
    currentIndex: number;
    remainingSeeds: number;
    utilizationPercentage: number;
    shouldRotate: boolean;
    rotationThreshold: number;
}
export interface RotationStrategy {
    enabled: boolean;
    thresholdPercentage: number;
    minRemainingSeeds: number;
    autoGenerateNewChain: boolean;
    autoUpdateContract: boolean;
}
export interface AnchorUpdateCallback {
    (newAnchor: string): Promise<void>;
}
export declare class ChainManager {
    private chain;
    private chainPath;
    private currentIndex;
    private rotationStrategy;
    private anchorUpdateCallback?;
    constructor(rotationStrategy?: Partial<RotationStrategy>, customChainPath?: string);
    private loadChain;
    /**
     * Finds the next seed to reveal based on the current anchor.
     * Now includes automatic rotation detection and warnings.
     */
    getNextSeed(currentAnchor: string): string;
    /**
     * Get detailed statistics about current chain usage
     */
    getChainStats(): ChainStats;
    /**
     * Handle rotation when threshold is reached
     */
    private handleRotationNeeded;
    /**
     * Generate a new hash chain and save it
     */
    private generateNewChain;
    /**
     * Manual rotation trigger
     */
    rotateChain(chainLength?: number): Promise<string>;
    /**
     * Set the callback function for automatic anchor updates
     */
    setAnchorUpdateCallback(callback: AnchorUpdateCallback): void;
    /**
     * Enable or disable automatic contract updates
     */
    setAutoUpdateContract(enabled: boolean): void;
    /**
     * Verify a seed against expected hash
     */
    verifySeed(seed: string, expectedHash: string): boolean;
    /**
     * Get chain health metrics
     */
    getHealthMetrics(): {
        chainLength: number;
        currentUtilization: number;
        estimatedRequestsRemaining: number;
        status: "healthy" | "warning" | "critical";
        recommendations: string[];
    };
    /**
     * Get the current anchor (first element)
     */
    getCurrentAnchor(): string;
    /**
     * Get chain segment for testing/verification
     */
    getChainSegment(start: number, end: number): string[];
}
//# sourceMappingURL=chain-manager.d.ts.map