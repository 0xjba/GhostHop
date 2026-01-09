# PRD: GhostHop Bridge (v1.0)

**Project:** One-Click Cross-Chain Gateway
**Routes:** Base/Arb/Solana  Ethereum L1  TEN L2
**Tech Stack:** Across V3 (Transport) + GhostHop Adapter (Settlement)
**Status:** Ready for Sepolia Deployment

---

## 1. Architecture Flow

**"The GhostHop Flow"** describes a user intent execution across two hops:

1. **Leg 1 (Transport):** User signs intent on Source Chain. Across Relayer fills the order on Ethereum L1, delivering funds to `GhostHopAdapter`.
2. **Leg 2 (Settlement):** `GhostHopAdapter` automatically approves and deposits funds into `TenBridge`.
3. **Fail-Safe:** If `TenBridge` reverts (due to Paused state or Non-Whitelist), Adapter **refunds User on L1** instantly.

---

## 2. Smart Contract Specification

* **Contract Name:** `GhostHopAdapter.sol`
* **Solidity Version:** `0.8.20`
* **Network:** Ethereum Mainnet & Sepolia
* **Dependencies:** `@openzeppelin/contracts` (v5.x), Across V3 Interface

### **A. Adapter Code (Final)**

*Save as: `contracts/GhostHopAdapter.sol*`

```solidity
// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

interface IAcrossMessageRecipient {
    function handleV3AcrossMessage(
        address tokenSent,
        uint256 amount,
        address relayer,
        bytes memory message
    ) external;
}

interface ITenBridge {
    function sendNative(address receiver) external payable;
    function sendERC20(address asset, uint256 amount, address receiver) external payable;
}

contract GhostHopAdapter is IAcrossMessageRecipient {
    using SafeERC20 for IERC20;

    address public immutable nativeBridge;
    address public immutable acrossSpokePool;

    event AutoRefunded(address indexed user, address token, uint256 amount, string reason);

    constructor(address _nativeBridge, address _acrossSpokePool) {
        nativeBridge = _nativeBridge;
        acrossSpokePool = _acrossSpokePool;
    }

    // ACROSS V3 HOOK: Called automatically by SpokePool
    function handleV3AcrossMessage(
        address tokenSent,
        uint256 amount,
        address, 
        bytes memory message
    ) external override {
        require(msg.sender == acrossSpokePool, "GhostHop: Unauthorized");
        
        // Decode User's L2 Address
        address userL2 = abi.decode(message, (address));

        if (tokenSent == address(0)) {
             _bridgeEth(userL2, amount);
        } else {
             _bridgeToken(tokenSent, userL2, amount);
        }
    }

    // INTERNAL LOGIC: Approve -> Deposit -> Catch Failures
    function _bridgeToken(address token, address user, uint256 amount) internal {
        if (IERC20(token).allowance(address(this), nativeBridge) < amount) {
            IERC20(token).approve(nativeBridge, type(uint256).max);
        }
        try ITenBridge(nativeBridge).sendERC20(token, amount, user) {
            // Success: Funds moved to TEN
        } catch {
            // Failure: Refund to User on L1
            IERC20(token).safeTransfer(user, amount);
            emit AutoRefunded(user, token, amount, "GhostHop: Bridge Failed");
        }
    }

    function _bridgeEth(address user, uint256 amount) internal {
        try ITenBridge(nativeBridge).sendNative{value: amount}(user) {
            // Success
        } catch {
            (bool sent, ) = user.call{value: amount}("");
            require(sent, "GhostHop: Refund Failed");
            emit AutoRefunded(user, address(0), amount, "GhostHop: Bridge Failed");
        }
    }

    receive() external payable {}
}

```

---

## 3. Configuration Data (The "Gold" List)

Use these exact addresses for your config files.

### **A. Ethereum Sepolia (Destination)**

| Contract | Address | Notes |
| --- | --- | --- |
| **Across V3 SpokePool** | `0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662` | **Hardcoded** |
| **USDC (Sepolia)** | `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` | Whitelist target |
| **Native Bridge** | *[YOUR_DEPLOYED_ADDRESS]* | Pass to Constructor |

### **B. Base Sepolia (Source Testing)**

| Asset | Address |
| --- | --- |
| **USDC (Base Sepolia)** | `0x036CbD53842c5426634e7929541eC2318f3dCF7e` |
| **Chain ID** | `84532` |

### **C. Solana (Mainnet Only)**

*Warning: Across does NOT support Solana Testnet. Test Solana flows on Mainnet.*
| Param | Value |
| :--- | :--- |
| **Chain ID** | `34268394551451` |
| **USDC (Solana)** | `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v` |

---

## 4. Frontend Specifications

**Stack:** Next.js 14, RainbowKit, Wagmi, `@across-protocol/app-sdk`.

### **A. Quote Construction (EVM)**

How to generate the transaction using Across SDK:

```javascript
import { ethers } from "ethers";

// 1. ENCODE MESSAGE: Just the User's L2 Wallet Address
const message = ethers.utils.defaultAbiCoder.encode(
  ["address"],
  [userWalletAddress] 
);

// 2. REQUEST QUOTE
const quoteParams = {
  originChainId: 84532, // Base Sepolia
  destinationChainId: 11155111, // Eth Sepolia
  inputToken: "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base USDC
  outputToken: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238", // Eth USDC
  amount: "1000000", // 1 USDC (6 decimals)
  recipient: GHOSTHOP_ADAPTER_ADDRESS, // <--- FUNDS SENT HERE
  message: message // <--- TRIGGERS ADAPTER LOGIC
};

```

### **B. Pre-Flight Checks (Critical)**

The UI **must disable** the "Bridge" button if:

1. **Bridge Paused:** `TenBridge.paused() == true`
2. **Token Not Supported:** `TenBridge.hasRole(ERC20_TOKEN_ROLE, token) == false`
* *Reason: Prevents users from paying fees just to be auto-refunded.*



---

## 5. Deployment Plan (Execute Now)

### **Step 1: Deploy Adapter (Sepolia)**

Run this Hardhat script to deploy `GhostHopAdapter`.

*File: `scripts/deployGhostHop.ts*`

```typescript
import { ethers } from "hardhat";

async function main() {
  const NATIVE_BRIDGE = "YOUR_L1_BRIDGE_ADDRESS_HERE"; // <--- UPDATE THIS
  const ACROSS_V3_SPOKEPOOL = "0x5ef6C01E11889d86803e0B23e3cB3F9E9d97B662"; 

  console.log("👻 Deploying GhostHopAdapter...");
  const GhostHop = await ethers.getContractFactory("GhostHopAdapter");
  const adapter = await GhostHop.deploy(NATIVE_BRIDGE, ACROSS_V3_SPOKEPOOL);
  await adapter.deployed();

  console.log("✅ GhostHop Live at:", adapter.address);
  console.log(`Verify: npx hardhat verify --network sepolia ${adapter.address} "${NATIVE_BRIDGE}" "${ACROSS_V3_SPOKEPOOL}"`);
}
main().catch((e) => { console.error(e); process.exitCode = 1; });

```

### **Step 2: Whitelist USDC (L1)**

You **must** run this on your `TenBridge` contract or the Adapter will fail.

* **Function:** `whitelistToken`
* **Asset:** `0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238` (Sepolia USDC)
* **Name/Symbol:** "USDC", "USDC"

### **Step 3: End-to-End Test**

1. Go to **Base Sepolia**.
2. Send **1 USDC** via Across to your new **GhostHopAdapter Address**.
3. Check TEN L2 Explorer for balance update.
