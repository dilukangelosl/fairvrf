import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const PythExampleConsumerModule = buildModule("PythExampleConsumerModule", (m) => {
  // Use the PythToFairVRFAdapter address provided by user or default
  const adapterAddress = m.getParameter("adapterAddress", "0x9Ae17f3cCFB9a2C754cEd486BE9eaA6cf088c48E");

  const consumer = m.contract("PythExampleConsumer", [adapterAddress]);

  return { consumer };
});

export default PythExampleConsumerModule;
