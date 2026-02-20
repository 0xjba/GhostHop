// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

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
    function valueTransferFee() external view returns (uint256); // Added to fetch exact TEN fee
}

contract GhostHopAdapter is IAcrossMessageRecipient, Ownable {
    using SafeERC20 for IERC20;

    address public immutable nativeBridge;
    address public immutable acrossSpokePool;
    address public immutable wrappedNativeToken;

    // L1 Catcher Configuration for 7-Day Exits
    address public l1CatcherFactory;
    bytes32 public l1CatcherInitCodeHash;

    event AutoRefunded(address indexed user, address token, uint256 amount, string reason);
    event BridgeRequestedSlow(address indexed sender, address indexed recipient, uint256 destinationChainId, uint256 bridgeAmount, uint256 protocolFee);

    constructor(
        address _nativeBridge, 
        address _acrossSpokePool, 
        address _wrappedNativeToken,
        address _initialOwner
    ) Ownable(_initialOwner) {
        require(_nativeBridge != address(0), "GhostHop: Invalid Native Bridge");
        require(_acrossSpokePool != address(0), "GhostHop: Invalid Spoke Pool");
        require(_wrappedNativeToken != address(0), "GhostHop: Invalid WETH");
        
        nativeBridge = _nativeBridge;
        acrossSpokePool = _acrossSpokePool;
        wrappedNativeToken = _wrappedNativeToken;
    }

    // ==========================================
    // INBOUND LOGIC (Fast Path - Across -> TEN)
    // ==========================================
    function handleV3AcrossMessage(
        address tokenSent,
        uint256 amount,
        address, // relayer - unused
        bytes memory message
    ) external override {
        require(msg.sender == acrossSpokePool, "GhostHop: Unauthorized");
        address userL2 = abi.decode(message, (address));

        if (tokenSent == address(0)) {
             _bridgeEth(userL2, amount);
        } 
        else if (tokenSent == wrappedNativeToken) {
             try IWETH(wrappedNativeToken).withdraw(amount) {
                 _bridgeEth(userL2, amount);
             } catch {
                 IERC20(tokenSent).safeTransfer(userL2, amount);
                 emit AutoRefunded(userL2, tokenSent, amount, "GhostHop: Unwrap Failed");
             }
        }
        else {
             _bridgeToken(tokenSent, userL2, amount);
        }
    }

    function _bridgeToken(address token, address user, uint256 amount) internal {
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
        try ITenBridge(nativeBridge).sendNative{value: amount}(user) {
            // Success
        } catch {
            (bool sent, ) = user.call{value: amount}("");
            require(sent, "GhostHop: Refund Failed");
            emit AutoRefunded(user, address(0), amount, "GhostHop: Bridge Failed");
        }
    }

    // ==========================================
    // OUTBOUND LOGIC (Slow Path - TEN -> L1 -> Base/Arb/Opt)
    // ==========================================

    function setL1CatcherConfig(address _factory, bytes32 _initCodeHash) external onlyOwner {
        l1CatcherFactory = _factory;
        l1CatcherInitCodeHash = _initCodeHash;
    }

    /**
     * @notice Initiates a 7-day exit from TEN to any destination chain via L1
     * @param recipient The user's address on the destination chain
     * @param destinationChainId The Across Chain ID (e.g., 8453 for Base, 42161 for Arbitrum)
     */
    function bridgeOutSlow(address recipient, uint256 destinationChainId) external payable {
        require(l1CatcherFactory != address(0), "GhostHop: L1 Factory not configured");
        
        uint256 tenFee = ITenBridge(nativeBridge).valueTransferFee();
        require(msg.value > tenFee, "GhostHop: Amount must cover TEN protocol fee");

        // 1. Get the multi-chain specific Catcher Address on L1
        address l1Catcher = getL1CatcherAddress(recipient, destinationChainId);

        // 2. Send funds to that specific Catcher via TEN Bridge
        ITenBridge(nativeBridge).sendNative{value: msg.value}(l1Catcher);

        emit BridgeRequestedSlow(msg.sender, recipient, destinationChainId, msg.value - tenFee, tenFee);
    }

    /**
     * @notice Computes where the L1 Catcher will be deployed for this specific exit
     */
    function getL1CatcherAddress(address recipient, uint256 destinationChainId) public view returns (address) {
        bytes32 salt = keccak256(abi.encodePacked(recipient, destinationChainId));
        return address(uint160(uint256(keccak256(abi.encodePacked(
            hex"ff",
            l1CatcherFactory,
            salt,
            l1CatcherInitCodeHash
        )))));
    }

    receive() external payable {}
}