import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const PythExampleConsumerModuleV2 = buildModule("PythExampleConsumerModuleV2", (m) => {
  // Use the NEW PythToFairVRFAdapter address
  const adapterAddress = m.getParameter("adapterAddress", "0x7f0375BCDdBD8C069685d147C1551A077df786AC");

  const consumer = m.contract("PythExampleConsumer", [adapterAddress]);

  return { consumer };
});

export default PythExampleConsumerModuleV2;
