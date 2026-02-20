# GhostHop Bridge

GhostHop is a one-click, two-hop bridge adapter for [TEN L2](https://ten.xyz). It leverages [Across V3](https://across.to) for secure transport from source chains (Base, Arb, Solana) to Ethereum L1, where the `GhostHopAdapter` automatically deposits funds into the TEN Native Bridge.

## Architecture

1.  **Leg 1 (Transport):** User deposits funds into Across SpokePool on source chain with a message containing their TEN L2 address.
2.  **Leg 2 (Settlement):** Across Relayer fills the order on Ethereum L1, calling `GhostHopAdapter.handleV3AcrossMessage()`.
3.  **Finality:** Adapter approves and deposits funds into `TenBridge`.
4.  **Fail-Safe:** If `TenBridge` is paused or reverts, the Adapter automatically refunds the user on Ethereum L1.

## Repository Structure

- `contracts/`: Solidity source for `GhostHopAdapter.sol`.
- `scripts/`: Hardhat deployment and maintenance scripts.
- `frontend/`: Next.js 14 bridge interface.
- `env.example`: Template for required environment variables.

## Getting Started

### 1. Smart Contract Setup

Install dependencies and compile:

```bash
npm install
npx hardhat compile
```

Configure your environment:

```bash
cp env.example .env
# Fill in PRIVATE_KEY, RPC URLs, and TEN_BRIDGE_ADDRESS_L1
```

Deploy to Sepolia:

```bash
npx hardhat run scripts/deployGhostHop.ts --network sepolia
```

### 2. Frontend Setup

Navigate to the frontend directory:

```bash
cd frontend
npm install
```

Update `frontend/lib/across.ts` with your deployed `GHOSTHOP_ADAPTER_ADDRESS_SEPOLIA`.

Run the development server:

```bash
npm run dev
```

## Testing (Sepolia)

1.  **Success Path:** Bridge USDC from **Base Sepolia** using the UI. Verify arrival on TEN L2.
2.  **Fail-Safe Path:** If the TEN Bridge is paused on L1, trigger a bridge. Verify that funds are auto-refunded to your wallet on Ethereum Sepolia.

## Technical Nuances

- **Solana Support:** Transport is supported on **Mainnet Only** (Across does not support Solana Testnets).
- **Encoding:** Frontend uses `viem` for EIP-712 and ABI encoding.
- **Verification:** Always verify the Adapter on Etherscan so Across relayers can inspect the logic.

## Security

- The Adapter only accepts calls from the official Across `SpokePool`.
- `SafeERC20` is used for all token transfers.
- `try/catch` blocks wrap all bridge interactions to ensure no funds are stuck in the adapter.


## Watcher Bot (Outbound Flow)

The watcher bot monitors for "slow path" exits (7-day challenge period) from TEN to L1.

### Setup

1. Configure `TEN_RPC_URL`, `L1_RPC_URL`, and `BOT_PRIVATE_KEY` in `.env`.
2. Run the bot:

```bash
npx hardhat run scripts/bot/watcherBot.ts --network sepolia
```

### Technical Note
The `watcherBot.ts` script uses a placeholder method `ten_getCrossChainProof` to fetch cross-chain proofs from the TEN node. You will need to replace this with the actual JSON-RPC method provided by the TEN protocol documentation once available.
