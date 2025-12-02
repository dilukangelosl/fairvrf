import "dotenv/config";
import hardhatToolboxViemPlugin from "@nomicfoundation/hardhat-toolbox-viem";
import hardhatVerifyPlugin from "@nomicfoundation/hardhat-verify";
import { configVariable, defineConfig } from "hardhat/config";

export default defineConfig({
  plugins: [hardhatToolboxViemPlugin, hardhatVerifyPlugin],
  solidity: {
    profiles: {
      default: {
        version: "0.8.28",
        settings: {
            optimizer: {
              enabled: true,
              runs: 200,
            },
        },
      },
      production: {
        version: "0.8.28",
        settings: {
          optimizer: {
            enabled: true,
            runs: 200,
          },
        },
      },
    },
  },
  networks: {
    hardhatMainnet: {
      type: "edr-simulated",
      chainType: "l1",
    },
    hardhatOp: {
      type: "edr-simulated",
      chainType: "op",
    },
    sepolia: {
      type: "http",
      chainType: "l1",
      url: configVariable("SEPOLIA_RPC_URL"),
      accounts: [configVariable("SEPOLIA_PRIVATE_KEY")],
    },
    apechain: {
      type: "http",
      chainType: "l1",
      url: configVariable("APECHAIN_RPC_URL") || "https://rpc.apechain.com",
      accounts: [configVariable("APECHAIN_PRIVATE_KEY")],
      chainId: 33139,
    },
  },
  verify: {
    etherscan: {
      apiKey: configVariable("ETHERSCAN_API_KEY", "{variable}"),
    },
  },
  chainDescriptors: {
    33139: {
      name: "ApeChain",
      blockExplorers: {
        etherscan: {
          name: "ApeScan",
          url: "https://apescan.io",
          apiUrl: "https://api.apescan.io/api",
        },
      },
    },
  },
});
