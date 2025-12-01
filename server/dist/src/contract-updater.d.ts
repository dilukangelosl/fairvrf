export interface ContractUpdateConfig {
    contractAddress?: string;
    privateKey?: string;
    rpcUrl?: string;
    chainId?: number;
}
export interface ContractUpdateResult {
    success: boolean;
    transactionHash?: string;
    blockNumber?: bigint;
    gasUsed?: bigint;
    error?: string;
}
/**
 * Updates the anchor in a FairVRF contract
 */
export declare function updateContractAnchor(newAnchor: string, config?: ContractUpdateConfig): Promise<ContractUpdateResult>;
/**
 * Creates an anchor update callback for use with ChainManager
 */
export declare function createAnchorUpdateCallback(config?: ContractUpdateConfig): (newAnchor: string) => Promise<void>;
/**
 * Logs the result of a contract update attempt
 */
export declare function logContractUpdateResult(newAnchor: string, result: ContractUpdateResult, contractAddress?: string): void;
//# sourceMappingURL=contract-updater.d.ts.map