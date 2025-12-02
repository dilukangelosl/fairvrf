import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const PythToFairVRFAdapterModuleV2 = buildModule("PythToFairVRFAdapterModuleV2", (m) => {
  // Get FairVRF coordinator address from environment or use deployed address
  // Use the same coordinator as before
  const fairVRFCoordinator = m.getParameter("fairVRFCoordinator", "0x48c579b565de9FBfd2E6800952b947E090Ff9cd0");

  // Deploy the adapter calling it "PythToFairVRFAdapter" (contract name)
  // But the module ID is different so Ignition treats it as new.
  const adapter = m.contract("PythToFairVRFAdapter", [fairVRFCoordinator]);

  return { adapter };
});

export default PythToFairVRFAdapterModuleV2;
