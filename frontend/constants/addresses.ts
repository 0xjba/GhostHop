export const CHAIN_IDS = {
  ETHEREUM_SEPOLIA: 11155111,
  BASE_SEPOLIA: 84532,
  ARBITRUM_SEPOLIA: 421614,
  OPTIMISM_SEPOLIA: 11155420,
  SOLANA_DEVNET: 133268194659241, // Derived from your JSON
};

export const ADDRESSES = {
  // Transport Layer (Across SpokePool - Sepolia)
  ACROSS_SPOKE_POOL: "0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662" as `0x${string}`,

  // Custom Settlement Layer (Your Adapter)
  GHOSTHOP_ADAPTER: process.env.NEXT_PUBLIC_GHOSTHOP_ADAPTER_ADDRESS as `0x${string}` | undefined,
  
  // Target Bridge (TEN)
  TEN_BRIDGE_L1: process.env.NEXT_PUBLIC_TEN_BRIDGE_ADDRESS_L1 as `0x${string}` | undefined,

  // 1. USDC Addresses (Confirmed from JSON)
  USDC: {
    ETHEREUM_SEPOLIA: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238" as `0x${string}`,
    BASE_SEPOLIA: "0x036CbD53842c5426634e7929541eC2318f3dCF7e" as `0x${string}`,
    ARBITRUM_SEPOLIA: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d" as `0x${string}`,
    OPTIMISM_SEPOLIA: "0x5fd84259d66Cd46123540766Be93DFE6D43130D7" as `0x${string}`,
    SOLANA_DEVNET: "4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU",
  },
  
  // 2. ETH "Identifier" Addresses
  // Across uses the WETH address to identify "Native ETH" routes
  ETH: {
    ETHEREUM_SEPOLIA: "0xfFf9976782d46CC05630D1f6eBAb18b2324d6B14" as `0x${string}`,
    BASE_SEPOLIA: "0x4200000000000000000000000000000000000006" as `0x${string}`,
    ARBITRUM_SEPOLIA: "0x980B62Da83eFf3D4576C647993b0c1D7faf17c73" as `0x${string}`,
    OPTIMISM_SEPOLIA: "0x4200000000000000000000000000000000000006" as `0x${string}`,
  },
  
  // This is only used for the "value" field in the transaction, NOT the Quote API
  ZERO_ADDRESS: "0x0000000000000000000000000000000000000000" as `0x${string}`,
};