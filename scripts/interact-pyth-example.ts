import hre from "hardhat";
import { formatEther } from "viem";

async function main() {
  // Connect to the network to get viem instance
  // Hardhat 3 style? or just how this project is set up
  const connected = await (hre as any).network.connect();
  const viem = connected.viem;

  const [sender] = await viem.getWalletClients();
  const publicClient = await viem.getPublicClient();

  console.log(`Using account: ${sender.account.address}`);
  const balance = await publicClient.getBalance({ address: sender.account.address });
  console.log(`Balance: ${formatEther(balance)} ETH`);

  // Get the deployed contract
  // Assuming deploying via ignition happened, we can get address via deployments or user input
  // For now, let's try to get it if recently deployed, otherwise user must provide address
  
  // You can run this script with deployed address as argument if needed, 
  // or we just assume it's deployed at a known address if provided in environment
  
  // Hardcoded address provided by user
  let consumerAddress = "0xA62E83d49a5C8E6cD87d628C3a3D1Df6936E30b1";
  
  if (process.env.CONSUMER_ADDRESS) {
      consumerAddress = process.env.CONSUMER_ADDRESS;
  }

  console.log(`Using PythExampleConsumer at: ${consumerAddress}`);

  const consumer = await viem.getContractAt("PythExampleConsumer", consumerAddress as `0x${string}`);

  console.log("Requesting randomness...");
  
  // Send 0.01 ETH to cover any fees (Adapter is free but good practice)
  const fee = BigInt("10000000000000000"); // 0.01 ETH
  
  const hash = await consumer.write.requestRandomness([], {
    value: fee,
  });

  console.log(`Transaction sent: ${hash}`);
  
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  
  console.log(`Transaction mined in block ${receipt.blockNumber}`);

  // Find RandomnessRequested event
  const events = await consumer.getEvents.RandomnessRequested();
  
  // Filter for our transaction if multiple events
  // But for simplicity, let's check recent ones or assume latest
  // Or better, parse logs from receipt
  
  // Since getEvents returns all logs by default or filtered, 
  // let's look at the logs in the receipt if possible or fetch latest
  
  // We can parse logs from receipt using artifacts but viem makes it easy via getEvents with block range
  const logs = await publicClient.getContractEvents({
      address: consumer.address,
      abi: consumer.abi,
      eventName: 'RandomnessRequested',
      fromBlock: receipt.blockNumber,
      toBlock: receipt.blockNumber
  });

  if (logs.length > 0) {
      const sequenceNumber = (logs[0].args as any).sequenceNumber;
      console.log(`Randomness Requested! Sequence Number: ${sequenceNumber}`);
      console.log("Waiting for fulfillment...");
      
      // Wait for fulfillment (RandomnessReceived event)
      let fulfilled = false;
      let attempts = 0;
      const maxAttempts = 24; // Wait up to 2 minutes (24 * 5 seconds)
      
      while (!fulfilled && attempts < maxAttempts) {
          attempts++;
          console.log(`⏳ Checking for fulfillment... (attempt ${attempts}/${maxAttempts})`);
          
          try {
              // Check if the randomness has been fulfilled
              const fulfillmentLogs = await publicClient.getContractEvents({
                  address: consumer.address,
                  abi: consumer.abi,
                  eventName: 'RandomnessReceived',
                  fromBlock: receipt.blockNumber,
                  toBlock: 'latest'
              });
              
              // Filter for our sequence number
              const ourFulfillment = fulfillmentLogs.find((log: any) => 
                  (log.args as any).sequenceNumber === sequenceNumber
              );
              
              if (ourFulfillment) {
                  const randomValue = (ourFulfillment.args as any).randomValue;
                  console.log(`🎉 Randomness Fulfilled!`);
                  console.log(`   Sequence Number: ${sequenceNumber}`);
                  console.log(`   Random Value: ${randomValue}`);
                  console.log(`   Block: ${ourFulfillment.blockNumber}`);
                  console.log(`   Transaction: ${ourFulfillment.transactionHash}`);
                  fulfilled = true;
              } else {
                  // Wait 5 seconds before checking again
                  await new Promise(resolve => setTimeout(resolve, 5000));
              }
          } catch (error) {
              console.warn(`   Error checking fulfillment:`, (error as Error).message);
              await new Promise(resolve => setTimeout(resolve, 5000));
          }
      }
      
      if (!fulfilled) {
          console.log(`⚠️ Fulfillment not received after ${maxAttempts * 5} seconds`);
          console.log("The randomness request was submitted successfully, but fulfillment is taking longer than expected.");
          console.log("Check your server logs or try again later.");
      }
  } else {
      console.log("RandomnessRequested event not found in logs.");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
