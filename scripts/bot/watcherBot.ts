import { ethers } from "hardhat";
import { Provider, Contract, JsonRpcProvider, Wallet, AbiCoder, keccak256 } from "ethers";

// --- Configuration ---
const L2_ADAPTER_ADDRESS = "0x..."; // Your deployed GhostHopAdapter on TEN
const L1_MESSENGER_ADDRESS = "0x..."; // TEN Protocol's CrossChainMessenger on L1
const CHALLENGE_PERIOD_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

// --- ABIs ---
const ADAPTER_ABI = [
    "event BridgeRequestedSlow(address indexed sender, address indexed recipient, uint256 destinationChainId, uint256 bridgeAmount, uint256 protocolFee)"
];

// Extracted from TEN's CrossChainMessenger.sol
const L1_MESSENGER_ABI = [
    "function relayMessageWithProof(tuple(address sender, uint64 sequence, uint64 nonce, uint32 topic, bytes payload, uint8 consistencyLevel) message, bytes32[] calldata proof, bytes32 root) external",
    "function messageConsumed(bytes32 messageHash) external view returns (bool)"
];

async function main() {
    // 1. Setup Providers & Signer (The Backup Bot Wallet)
    // L2 Provider reads from TEN, L1 Signer executes on Ethereum
    const l2Provider = new ethers.JsonRpcProvider(process.env.TEN_RPC_URL);
    const l1Provider = new ethers.JsonRpcProvider(process.env.L1_RPC_URL);
    const botWallet = new ethers.Wallet(process.env.BOT_PRIVATE_KEY as string, l1Provider);

    console.log(`🤖 GhostHop Watcher Bot started. Address: ${botWallet.address}`);

    const l2Adapter = new ethers.Contract(L2_ADAPTER_ADDRESS, ADAPTER_ABI, l2Provider);
    const l1Messenger = new ethers.Contract(L1_MESSENGER_ADDRESS, L1_MESSENGER_ABI, botWallet);

    // 2. The Polling Loop (Runs every hour)
    setInterval(async () => {
        try {
            console.log("🔍 Scanning for pending 7-Day Exits...");
            await processPendingExits(l2Adapter, l1Messenger, l2Provider);
        } catch (error) {
            console.error("❌ Error in polling loop:", error);
        }
    }, 60 * 60 * 1000); // 1 hour interval

    // Run once immediately on startup
    await processPendingExits(l2Adapter, l1Messenger, l2Provider);
}

async function processPendingExits(l2Adapter: Contract, l1Messenger: Contract, l2Provider: Provider) {
    // Fetch events from the last 14 days (to catch anything missed)
    const currentBlock = await l2Provider.getBlockNumber();
    const startBlock = currentBlock - 100000; // Adjust block range based on TEN's block time

    const events = await l2Adapter.queryFilter("BridgeRequestedSlow", startBlock, currentBlock);

    for (const event of events) {
        const block = await event.getBlock();
        const timeSinceEvent = Date.now() - (block.timestamp * 1000);

        // Skip if 7 days haven't passed yet
        if (timeSinceEvent < CHALLENGE_PERIOD_MS) {
            continue;
        }

        console.log(`⚠️ Found mature exit request! TxHash: ${event.transactionHash}`);

        // 3. Fetch the TEN Cross-Chain Proof
        // Note: You will need to check TEN's official RPC documentation for the exact 
        // method name they use for cross-chain proofs. (e.g., 'ten_getCrossChainProof')
        const proofData = await (l2Provider as any).send("ten_getCrossChainProof", [event.transactionHash]);

        if (!proofData) {
            console.log("⏳ Proof not yet available on TEN node. Skipping.");
            continue;
        }

        // Parse the proof payload (matching TEN's Structs.CrossChainMessage)
        const crossChainMessage = {
            sender: proofData.message.sender,
            sequence: proofData.message.sequence,
            nonce: proofData.message.nonce,
            topic: proofData.message.topic,
            payload: proofData.message.payload,
            consistencyLevel: proofData.message.consistencyLevel
        };

        // 4. Check if it was already processed (Did the Enclave beat us?)
        // Hash the message exactly how CrossChainMessenger.sol does it
        const msgTypes = ["address", "uint64", "uint64", "uint32", "bytes", "uint8"];
        const msgValues = Object.values(crossChainMessage);
        const encodedMsg = ethers.AbiCoder.defaultAbiCoder().encode(msgTypes, msgValues);
        const msgHash = ethers.keccak256(encodedMsg);

        const isConsumed = await l1Messenger.messageConsumed(msgHash);
        if (isConsumed) {
            console.log("✅ Exit already processed by TEN Enclave. Nothing to do.");
            continue;
        }

        // 5. Execute the Fallback (We front the gas, L1 Catcher refunds us)
        console.log("🚀 Enclave missed it! Bot is fronting the execution gas...");

        try {
            const tx = await l1Messenger.relayMessageWithProof(
                crossChainMessage,
                proofData.proof, // The array of bytes32 Merkle proof hashes
                proofData.root,  // The Merkle root
                {
                    gasLimit: 800000 // High limit to ensure Messenger -> Catcher -> Across all succeed
                }
            );

            console.log(`🛠️ Tx Submitted: ${tx.hash}`);
            await tx.wait();
            console.log(`🎉 Exit successfully forced! Bot gas refunded.`);

        } catch (err) {
            console.error(`❌ Failed to relay message for tx ${event.transactionHash}:`, err);
        }
    }
}

main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
});
