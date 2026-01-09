export const CHAIN_IDS = {
  ETHEREUM_SEPOLIA: 11155111,
  BASE_SEPOLIA: 84532,
  SOLANA_MAINNET: 1399811149,
};

export const ADDRESSES = {
  // Transport Layer (Across)
  ACROSS_SPOKE_POOL_SEPOLIA: "0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662" as `0x${string}`,
  
  // Custom Settlement Layer
  GHOSTHOP_ADAPTER_SEPOLIA: process.env.NEXT_PUBLIC_GHOSTHOP_ADAPTER_ADDRESS as `0x${string}` | undefined,
  
  // Target Bridge (TEN)
  TEN_BRIDGE_L1_SEPOLIA: process.env.NEXT_PUBLIC_TEN_BRIDGE_ADDRESS_L1 as `0x${string}` | undefined,

  // Tokens
  USDC: {
    ETHEREUM_SEPOLIA: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as `0x${string}`,
    BASE_SEPOLIA: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`,
    SOLANA_MAINNET: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
  
  // Native Assets
  NATIVE_ETH: "0x0000000000000000000000000000000000000000" as `0x${string}`,
};

