import hre from "hardhat";

async function main() {
  // Connect to the network using Viem
  const { viem } = await hre.network.connect();
  
  // Get wallet clients (accounts)
  const walletClients = await viem.getWalletClients();
  const deployer = walletClients[0];
  
  // Get contract address from environment or command line
  const contractAddress = process.env.CONTRACT_ADDRESS;
  if (!contractAddress) {
    throw new Error("Please set CONTRACT_ADDRESS environment variable");
  }

  console.log(`Managing consumers for FairVRF contract at: ${contractAddress}`);
  console.log(`Using account: ${deployer.account.address}`);

  // Get the FairVRF contract instance
  const fairVRF = await viem.getContractAt("FairVRF", contractAddress as `0x${string}`);

  // Parse command line arguments
  const args = process.argv.slice(2);
  const command = args[0];

  switch (command) {
    case "status":
      await showWhitelistStatus(fairVRF);
      break;
    
    case "enable":
      await enableWhitelist(fairVRF, deployer, true);
      break;
    
    case "disable":
      await enableWhitelist(fairVRF, deployer, false);
      break;
    
    case "authorize":
      if (args.length < 2) {
        console.error("Usage: npx hardhat run scripts/manage-consumers.ts authorize <consumer_address>");
        process.exit(1);
      }
      await authorizeConsumer(fairVRF, deployer, args[1], true);
      break;
    
    case "deauthorize":
      if (args.length < 2) {
        console.error("Usage: npx hardhat run scripts/manage-consumers.ts deauthorize <consumer_address>");
        process.exit(1);
      }
      await authorizeConsumer(fairVRF, deployer, args[1], false);
      break;
    
    case "batch-authorize":
      if (args.length < 2) {
        console.error("Usage: npx hardhat run scripts/manage-consumers.ts batch-authorize <address1,address2,...>");
        process.exit(1);
      }
      const addresses = args[1].split(",").map(addr => addr.trim());
      await batchAuthorizeConsumers(fairVRF, deployer, addresses, true);
      break;
    
    case "check":
      if (args.length < 2) {
        console.error("Usage: npx hardhat run scripts/manage-consumers.ts check <consumer_address>");
        process.exit(1);
      }
      await checkConsumerAuth(fairVRF, args[1]);
      break;
    
    default:
      showUsage();
      break;
  }
}

async function showWhitelistStatus(fairVRF: any) {
  try {
    const isEnabled = await fairVRF.read.consumerWhitelistEnabled();
    console.log(`\nConsumer Whitelist Status: ${isEnabled ? "ENABLED" : "DISABLED"}`);
    
    if (isEnabled) {
      console.log("WARNING: Only authorized consumers can request randomness");
    } else {
      console.log("SUCCESS: Anyone can request randomness (open access)");
    }
  } catch (error) {
    console.error("Error checking whitelist status:", error);
  }
}

async function enableWhitelist(fairVRF: any, deployer: any, enabled: boolean) {
  try {
    console.log(`${enabled ? "Enabling" : "Disabling"} consumer whitelist...`);
    
    const hash = await fairVRF.write.setConsumerWhitelistEnabled([enabled], {
      account: deployer.account,
    });
    console.log(`Transaction sent: ${hash}`);
    
    console.log(`SUCCESS: Consumer whitelist ${enabled ? "enabled" : "disabled"} successfully!`);
    
    if (enabled) {
      console.log("WARNING: Remember to authorize consumer contracts before they can request randomness");
    }
  } catch (error) {
    console.error(`Error ${enabled ? "enabling" : "disabling"} whitelist:`, error);
  }
}

async function authorizeConsumer(fairVRF: any, deployer: any, consumerAddress: string, authorized: boolean) {
  try {
    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(consumerAddress)) {
      throw new Error(`Invalid address format: ${consumerAddress}`);
    }

    console.log(`${authorized ? "Authorizing" : "Deauthorizing"} consumer: ${consumerAddress}`);
    
    const hash = await fairVRF.write.setConsumerAuthorization([consumerAddress as `0x${string}`, authorized], {
      account: deployer.account,
    });
    console.log(`Transaction sent: ${hash}`);
    
    console.log(`SUCCESS: Consumer ${authorized ? "authorized" : "deauthorized"} successfully!`);
  } catch (error) {
    console.error(`Error ${authorized ? "authorizing" : "deauthorizing"} consumer:`, error);
  }
}

async function batchAuthorizeConsumers(fairVRF: any, deployer: any, addresses: string[], authorized: boolean) {
  try {
    // Validate all addresses
    for (const addr of addresses) {
      if (!/^0x[a-fA-F0-9]{40}$/.test(addr)) {
        throw new Error(`Invalid address format: ${addr}`);
      }
    }

    console.log(`Batch ${authorized ? "authorizing" : "deauthorizing"} ${addresses.length} consumers...`);
    addresses.forEach((addr, i) => console.log(`  ${i + 1}. ${addr}`));
    
    const authorizations = new Array(addresses.length).fill(authorized);
    
    const hash = await fairVRF.write.batchSetConsumerAuthorization([
      addresses as `0x${string}`[], 
      authorizations
    ], {
      account: deployer.account,
    });
    console.log(`Transaction sent: ${hash}`);
    
    console.log(`SUCCESS: Batch operation completed successfully!`);
  } catch (error) {
    console.error("Error in batch authorization:", error);
  }
}

async function checkConsumerAuth(fairVRF: any, consumerAddress: string) {
  try {
    // Validate address format
    if (!/^0x[a-fA-F0-9]{40}$/.test(consumerAddress)) {
      throw new Error(`Invalid address format: ${consumerAddress}`);
    }

    const isWhitelistEnabled = await fairVRF.read.consumerWhitelistEnabled();
    const isAuthorized = await fairVRF.read.authorizedConsumers([consumerAddress as `0x${string}`]);
    
    console.log(`\nConsumer Authorization Status:`);
    console.log(`Address: ${consumerAddress}`);
    console.log(`Whitelist Enabled: ${isWhitelistEnabled}`);
    console.log(`Consumer Authorized: ${isAuthorized}`);
    
    if (!isWhitelistEnabled) {
      console.log("SUCCESS: Consumer can request randomness (whitelist disabled)");
    } else if (isAuthorized) {
      console.log("SUCCESS: Consumer can request randomness");
    } else {
      console.log("ERROR: Consumer CANNOT request randomness (not authorized)");
    }
  } catch (error) {
    console.error("Error checking consumer authorization:", error);
  }
}

function showUsage() {
  console.log(`
FairVRF Consumer Management Script

Usage:
  npx hardhat run scripts/manage-consumers.ts <command> [args] --network <network>

Commands:
  status                           - Show current whitelist status
  enable                          - Enable consumer whitelist
  disable                         - Disable consumer whitelist
  authorize <address>             - Authorize a consumer contract
  deauthorize <address>           - Deauthorize a consumer contract
  batch-authorize <addr1,addr2>   - Batch authorize multiple consumers
  check <address>                 - Check if a consumer is authorized

Examples:
  # Check current status
  npx hardhat run scripts/manage-consumers.ts status --network sepolia

  # Enable whitelist
  npx hardhat run scripts/manage-consumers.ts enable --network sepolia

  # Authorize a consumer
  npx hardhat run scripts/manage-consumers.ts authorize 0x1234567890123456789012345678901234567890 --network sepolia

  # Batch authorize multiple consumers
  npx hardhat run scripts/manage-consumers.ts batch-authorize 0x1111...,0x2222...,0x3333... --network sepolia

  # Check consumer authorization
  npx hardhat run scripts/manage-consumers.ts check 0x1234567890123456789012345678901234567890 --network sepolia

Environment Variables:
  CONTRACT_ADDRESS - The deployed FairVRF contract address
`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
