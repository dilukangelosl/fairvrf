Here is the comprehensive Product Requirements Document (PRD) for **FairVRF**, designed as a self-hosted, drop-in replacement for paid randomness oracles.

---

# Product Requirements Document: FairVRF

| **Project Name** | FairVRF (Self-Hosted Toolkit) |
| :--- | :--- |
| **Version** | 1.0 |
| **Status** | Draft |
| **Target Network** | ApeChain (Primary), Any EVM Compatible |
| **License** | MIT (Open Source) |

## 1. Executive Summary
**FairVRF** is an open-source toolkit that allows Web3 developers to deploy and operate their own Verifiable Random Function (VRF) infrastructure. Unlike Chainlink or Pyth, which charge per-request fees or require token subscriptions, FairVRF is **free to operate** (gas only) and **self-sovereign**.

It utilizes a "Provably Fair" commit-reveal mechanism—standard in the online gambling industry—allowing users to cryptographically verify that the randomness was not manipulated by the project owner.

## 2. Problem Statement
*   **High Costs:** Existing VRF solutions charge ~$0.25 - $3.00 per request. For high-frequency games (e.g., on-chain RPGs, casinos), this makes the unit economics unviable.
*   **External Dependency:** Projects rely on third-party node operators. If they go down or deprecate support for a chain, the project stalls.
*   **Complexity:** Integrating oracles often involves managing subscription balances, LINK tokens, and complex callbacks.
*   **Trust Opacity:** While Chainlink is "trustless," it is a black box to the average user.

## 3. Product Vision
To democratize on-chain randomness by providing a "WordPress-like" experience: easy to install, fully owned by the user, and free to run. The goal is to become the default VRF solution for indie games, hackathon projects, and high-frequency gambling apps on ApeChain.

## 4. User Personas

### 4.1. The Developer (Primary)
*   **Goal:** Wants to add randomness to their NFT mint or GameFi project.
*   **Pain Point:** Doesn't want to buy LINK or pay monthly fees.
*   **Needs:** A simple contract to deploy and a script to run the server. Needs it to look exactly like Chainlink so they don't have to learn a new API.

### 4.2. The Player (End-User)
*   **Goal:** Wants to know the game isn't rigged.
*   **Pain Point:** Casinos are usually black boxes.
*   **Needs:** A "Verify" button to check the math behind the result.

## 5. Functional Requirements

### 5.1. Smart Contracts (Solidity)
The core logic running on ApeChain.

| ID | Feature | Description | Priority |
| :--- | :--- | :--- | :--- |
| **SC-1** | **Seed Commitment** | Store hashes of future server seeds. Only the owner can commit. | P0 |
| **SC-2** | **Request Interface** | `requestRandomWords` function matching Chainlink VRF V2 signature. | P0 |
| **SC-3** | **Fulfillment Logic** | Verify revealed seed matches commitment + Verify block hash + Compute result. | P0 |
| **SC-4** | **Consumer Base** | Abstract contract (`FairVRFConsumer`) for easy integration. | P1 |
| **SC-5** | **Entropy Mixing** | Formula: `keccak256(serverSeed + userSeed + blockHash + requestId)`. | P0 |
| **SC-6** | **Verification View** | `verifyRandomness` view function for UI/Frontend checks. | P1 |
| **SC-7** | **Gas Efficiency** | Minimal gas cost for fulfillment (< 100k gas). | P2 |

### 5.2. Off-Chain Server (Node.js/Docker)
The infrastructure the developer runs.

| ID | Feature | Description | Priority |
| :--- | :--- | :--- | :--- |
| **SRV-1** | **Auto-Fulfillment** | Listen for `RandomRequested` events and submit fulfillment txs. | P0 |
| **SRV-2** | **Seed Management** | Generate cryptographically secure random seeds and manage local storage. | P0 |
| **SRV-3** | **Batch Commitment** | Automatically top-up on-chain commitments when low. | P1 |
| **SRV-4** | **Dockerization** | Pre-built image `fairvrf/server` for one-line deployment. | P1 |
| **SRV-5** | **Wallet Management** | Support for raw private keys and cloud KMS (AWS/GCP). | P2 |

### 5.3. Developer SDK & UI
Tools to improve the experience.

| ID | Feature | Description | Priority |
| :--- | :--- | :--- | :--- |
| **SDK-1** | **React Hook** | `useFairVRF` hook to fetch request status and verification data. | P2 |
| **SDK-2** | **Verify Component** | A pre-styled React component that users can drop into their dApp. | P1 |
| **SDK-3** | **Deploy Script** | Hardhat/Foundry script to deploy contract + configure server. | P1 |

## 6. Technical Architecture

### 6.1. The "Provably Fair" Mechanism
1.  **Setup:** Server generates 100 random seeds (s1...s100). Hashes them (h1...h100). Submits hashes to contract.
2.  **Request:** User calls `requestRandomWords(userSeed)`. Contract assigns `h1` to this request.
3.  **Wait:** Request waits for `Block X`.
4.  **Fulfillment:**
    *   Server waits for `Block X`.
    *   Server submits `s1` (the actual seed) to the contract.
5.  **Verification (On-Chain):**
    *   Contract checks `keccak256(s1) == h1`. If not, revert.
    *   Contract calculates `random = keccak256(s1 + userSeed + blockhash(X))`.
    *   Contract sends `random` back to user.

### 6.2. Compatibility Layer
To ensure zero friction for migration, FairVRF mimics established patterns:
*   **Chainlink:** Same function names (`requestRandomWords`, `fulfillRandomWords`).
*   **Pyth:** Same entropy request flow (optional adapter).

## 7. Security & Risk Analysis

| Risk | Probability | Impact | Mitigation |
| :--- | :--- | :--- | :--- |
| **Server Downtime** | Medium | High | Requests hang. **Mitigation:** Allow users to cancel/refund request after `N` blocks of no response. |
| **Seed Loss** | Low | Critical | If server loses seeds, it cannot fulfill. **Mitigation:** Server backs up seeds to local disk/database immediately upon generation. |
| **L3 Sequencer Manipulation** | Low | Medium | Sequencer could censor fulfillment. **Mitigation:** Use `blockhash` of specific L2 block or assume honest sequencer (standard for L3s). |
| **Admin Cheating** | Low | High | Admin *cannot* change the outcome after request (due to commitment), but could withhold fulfillment. **Mitigation:** Social reputation; "Withholding" is the only attack vector. |

## 8. Roadmap

### Phase 1: MVP (Weeks 1-2)
*   Core `FairVRF.sol` contract.
*   Basic Node.js script for the server.
*   Hardhat deployment scripts.
*   Documentation for "Local Dev" setup.

### Phase 2: Production Ready (Weeks 3-4)
*   Docker containerization.
*   `FairVRFConsumer` base class.
*   React Verification Component.
*   NPM Package release.

### Phase 3: Ecosystem Integration (Weeks 5+)
*   One-click deploy template for Vercel/Railway.
*   Subgraph integration.
*   ApeChain template repository (Game + VRF pre-configured).

## 9. Success Metrics
*   **Cost Savings:** $ saved by projects vs using Chainlink.
*   **Adoption:** Number of GitHub stars and forks.
*   **Usage:** Number of live deployments on ApeChain mainnet.
*   **Speed:** Average fulfillment time (aiming for < 5 seconds).

---

## Appendix: API Interface Specification

**Request (User):**
```solidity
function requestRandomWords(
    bytes32 keyHash, // Ignored (compat)
    uint64 subId,    // Ignored (compat)
    uint16 requestConfirmations,
    uint32 callbackGasLimit,
    uint32 numWords
) external returns (uint256 requestId);
```

**Fulfillment (Server):**
```solidity
function fulfillRandomness(
    uint256 requestId,
    bytes32 serverSeed
) external;
```

**Verification (View):**
```solidity
function verifyRandomness(
    uint256 requestId, 
    bytes32 serverSeed
) external view returns (bool isValid, uint256[] memory randomWords);
```