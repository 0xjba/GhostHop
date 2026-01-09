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
        require(_nativeBridge != address(0), "GhostHop: Invalid Native Bridge");
        require(_acrossSpokePool != address(0), "GhostHop: Invalid Spoke Pool");
        nativeBridge = _nativeBridge;
        acrossSpokePool = _acrossSpokePool;
    }

    // ACROSS V3 HOOK: Called automatically by SpokePool
    function handleV3AcrossMessage(
        address tokenSent,
        uint256 amount,
        address, // relayer - unused
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
        // Ensure approval for the bridge
        if (IERC20(token).allowance(address(this), nativeBridge) < amount) {
            IERC20(token).forceApprove(nativeBridge, type(uint256).max);
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
            // Failure: Refund ETH to User on L1
            (bool sent, ) = user.call{value: amount}("");
            require(sent, "GhostHop: Refund Failed");
            emit AutoRefunded(user, address(0), amount, "GhostHop: Bridge Failed");
        }
    }

    // To receive ETH from Across relayer when tokenSent is address(0)
    receive() external payable {}
}

