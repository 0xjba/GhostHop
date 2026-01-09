export const TEN_BRIDGE_ABI = [
  {
    "inputs": [],
    "name": "paused",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "bytes32", "name": "role", "type": "bytes32" },
      { "internalType": "address", "name": "account", "type": "address" }
    ],
    "name": "hasRole",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "view",
    "type": "function"
  }
] as const;

export const ERC20_ABI = [
  {
    "inputs": [
      { "internalType": "address", "name": "owner", "type": "address" },
      { "internalType": "address", "name": "spender", "type": "address" }
    ],
    "name": "allowance",
    "outputs": [{ "internalType": "uint256", "name": "", "type": "uint256" }],
    "stateMutability": "view",
    "type": "function"
  },
  {
    "inputs": [
      { "internalType": "address", "name": "spender", "type": "address" },
      { "internalType": "uint256", "name": "amount", "type": "uint256" }
    ],
    "name": "approve",
    "outputs": [{ "internalType": "bool", "name": "", "type": "bool" }],
    "stateMutability": "nonpayable",
    "type": "function"
  }
] as const;

export const ACROSS_SPOKE_POOL_ABI = [
  {
    "inputs": [
      { "internalType": "address", "name": "depositor", "type": "address" },
      { "internalType": "address", "name": "recipient", "type": "address" },
      { "internalType": "address", "name": "inputToken", "type": "address" },
      { "internalType": "address", "name": "outputToken", "type": "address" },
      { "internalType": "uint256", "name": "inputAmount", "type": "uint256" },
      { "internalType": "uint256", "name": "outputAmount", "type": "uint256" },
      { "internalType": "uint256", "name": "destinationChainId", "type": "uint256" },
      { "internalType": "address", "name": "exclusiveRelayer", "type": "address" },
      { "internalType": "uint32", "name": "quoteTimestamp", "type": "uint32" },
      { "internalType": "uint32", "name": "fillDeadline", "type": "uint32" },
      { "internalType": "uint32", "name": "exclusivityDeadline", "type": "uint32" },
      { "internalType": "bytes", "name": "message", "type": "bytes" }
    ],
    "name": "depositV3",
    "outputs": [],
    "stateMutability": "payable",
    "type": "function"
  }
] as const;

export const ERC20_TOKEN_ROLE = "0x0000000000000000000000000000000000000000000000000000000000000000"; // Placeholder for actual role if needed, or check implementation

