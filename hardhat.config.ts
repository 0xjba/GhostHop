import { HardhatUserConfig } from "hardhat/config";
import "@nomicfoundation/hardhat-toolbox";
import * as dotenv from "dotenv";

dotenv.config();

const SEPOLIA_RPC_URL = process.env.SEPOLIA_RPC_URL;
const BASE_SEPOLIA_RPC_URL = process.env.BASE_SEPOLIA_RPC_URL;
const PRIVATE_KEY = process.env.PRIVATE_KEY;

// Fail fast with clear error messages for developers
if (!SEPOLIA_RPC_URL && process.argv.includes("sepolia")) {
  throw new Error("Missing SEPOLIA_RPC_URL in .env");
}
if (!BASE_SEPOLIA_RPC_URL && process.argv.includes("baseSepolia")) {
  throw new Error("Missing BASE_SEPOLIA_RPC_URL in .env");
}
if (!PRIVATE_KEY && (process.argv.includes("sepolia") || process.argv.includes("baseSepolia"))) {
  throw new Error("Missing PRIVATE_KEY in .env");
}

const config: HardhatUserConfig = {
  solidity: {
    version: "0.8.20",
    settings: {
      optimizer: {
        enabled: true,
        runs: 200,
      },
    },
  },
  networks: {
    sepolia: {
      url: SEPOLIA_RPC_URL || "",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    baseSepolia: {
      url: BASE_SEPOLIA_RPC_URL || "",
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    }
  },
  etherscan: {
    apiKey: process.env.ETHERSCAN_API_KEY,
  },
  sourcify: {
    enabled: true
  }
};

export default config;

