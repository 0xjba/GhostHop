// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

// 1. Add Interface for Unwrapping
interface IWETH {
    function withdraw(uint256 amount) external;
}

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
    // 2. Add WETH Address Variable
    address public immutable wrappedNativeToken;

    event AutoRefunded(address indexed user, address token, uint256 amount, string reason);

    // 3. Update Constructor to accept WETH address
    constructor(
        address _nativeBridge, 
        address _acrossSpokePool, 
        address _wrappedNativeToken
    ) {
        require(_nativeBridge != address(0), "GhostHop: Invalid Native Bridge");
        require(_acrossSpokePool != address(0), "GhostHop: Invalid Spoke Pool");
        require(_wrappedNativeToken != address(0), "GhostHop: Invalid WETH");
        
        nativeBridge = _nativeBridge;
        acrossSpokePool = _acrossSpokePool;
        wrappedNativeToken = _wrappedNativeToken;
    }

    // ACROSS V3 HOOK
    function handleV3AcrossMessage(
        address tokenSent,
        uint256 amount,
        address, // relayer - unused
        bytes memory message
    ) external override {
        require(msg.sender == acrossSpokePool, "GhostHop: Unauthorized");
        
        address userL2 = abi.decode(message, (address));

        // 4. Logic: Handle Native ETH OR WETH (Unwrap & Send Native)
        if (tokenSent == address(0)) {
             // Case A: Received Native ETH directly (Rare for Across, but good to handle)
             _bridgeEth(userL2, amount);
        } 
        else if (tokenSent == wrappedNativeToken) {
             // Case B: Received WETH (Standard behavior). Unwrap it!
             try IWETH(wrappedNativeToken).withdraw(amount) {
                 // Successfully unwrapped WETH -> ETH. Now bridge as Native.
                 _bridgeEth(userL2, amount);
             } catch {
                 // Failed to unwrap? Refund WETH to user.
                 IERC20(tokenSent).safeTransfer(userL2, amount);
                 emit AutoRefunded(userL2, tokenSent, amount, "GhostHop: Unwrap Failed");
             }
        }
        else {
             // Case C: Standard ERC20 (USDC, etc.) - Will likely fail on TEN if not whitelisted
             _bridgeToken(tokenSent, userL2, amount);
        }
    }

    // INTERNAL LOGIC: Approve -> Deposit -> Catch Failures
    function _bridgeToken(address token, address user, uint256 amount) internal {
        // Ensure approval
        if (IERC20(token).allowance(address(this), nativeBridge) < amount) {
            IERC20(token).forceApprove(nativeBridge, type(uint256).max);
        }
        
        try ITenBridge(nativeBridge).sendERC20(token, amount, user) {
            // Success
        } catch {
            IERC20(token).safeTransfer(user, amount);
            emit AutoRefunded(user, token, amount, "GhostHop: Bridge Failed");
        }
    }

    function _bridgeEth(address user, uint256 amount) internal {
        // Native Bridge Call
        try ITenBridge(nativeBridge).sendNative{value: amount}(user) {
            // Success
        } catch {
            // Failure: Refund ETH to User on L1
            (bool sent, ) = user.call{value: amount}("");
            require(sent, "GhostHop: Refund Failed");
            emit AutoRefunded(user, address(0), amount, "GhostHop: Bridge Failed");
        }
    }

    receive() external payable {}
}