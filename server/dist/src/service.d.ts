interface ServiceMetrics {
    totalRequests: number;
    successfulFulfillments: number;
    failedFulfillments: number;
    averageResponseTime: number;
    uptime: number;
    lastHealthCheck: Date;
}
declare class FairVRFService {
    private client;
    private wallet;
    private chainManager;
    private metrics;
    private startTime;
    constructor();
    private startHealthMonitoring;
    private updateMetrics;
    private logHealthStatus;
    start(): Promise<void>;
    private handleRandomnessRequest;
    private updateAverageResponseTime;
    getMetrics(): ServiceMetrics;
    getChainHealth(): {
        chainLength: number;
        currentUtilization: number;
        estimatedRequestsRemaining: number;
        status: "healthy" | "warning" | "critical";
        recommendations: string[];
    };
    getChainStats(): import("./chain-manager.js").ChainStats;
    rotateChain(chainLength?: number): Promise<string>;
    /**
     * Update the contract anchor automatically when chain rotation occurs
     */
    private updateContractAnchor;
}
export { FairVRFService };
//# sourceMappingURL=service.d.ts.map