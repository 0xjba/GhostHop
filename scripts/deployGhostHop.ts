import { ethers } from "hardhat";
import * as dotenv from "dotenv";

dotenv.config();

async function main() {
  const TEN_BRIDGE_L1 = process.env.TEN_BRIDGE_ADDRESS_L1; 
  const ACROSS_V3_SPOKEPOOL = "0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662";
  const WETH_SEPOLIA = "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14"; 

  if (!TEN_BRIDGE_L1) {
    throw new Error("TEN_BRIDGE_ADDRESS_L1 not set in .env");
  }

  console.log("👻 Deploying GhostHopAdapter...");
  const GhostHop = await ethers.getContractFactory("GhostHopAdapter");
  
  // Hardhat 2.22+ uses ethers v6
  const adapter = await GhostHop.deploy(TEN_BRIDGE_L1, ACROSS_V3_SPOKEPOOL, WETH_SEPOLIA);
  await adapter.waitForDeployment();

  const adapterAddress = await adapter.getAddress();

  console.log("✅ GhostHop Live at:", adapterAddress);
  console.log(`Verify: npx hardhat verify --network sepolia ${adapterAddress} "${TEN_BRIDGE_L1}" "${ACROSS_V3_SPOKEPOOL}" "${WETH_SEPOLIA}"`);
}

main().catch((e) => {
  console.error(e);
  process.exitCode = 1;
});

