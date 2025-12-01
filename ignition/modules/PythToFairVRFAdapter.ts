import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const PythToFairVRFAdapterModule = buildModule("PythToFairVRFAdapterModule", (m) => {
  // Get FairVRF coordinator address from environment or use deployed address
  const fairVRFCoordinator = m.getParameter("fairVRFCoordinator", "0x48c579b565de9FBfd2E6800952b947E090Ff9cd0");

  // Deploy the adapter
  const adapter = m.contract("PythToFairVRFAdapter", [fairVRFCoordinator]);

  return { adapter };
});

export default PythToFairVRFAdapterModule;
