// SPDX-License-Identifier: MIT
pragma solidity 0.8.20;

interface IAcrossSpokePool {
    function depositV3(
        address depositor,
        address recipient,
        address inputToken,
        address outputToken,
        uint256 inputAmount,
        uint256 outputAmount,
        uint256 destinationChainId,
        address exclusiveRelayer,
        uint32 quoteTimestamp,
        uint32 fillDeadline,
        uint32 exclusivityDeadline,
        bytes calldata message
    ) external payable;
}

contract GhostHopCatcher {
    address public immutable recipient;
    uint256 public immutable destinationChainId;
    address public immutable acrossSpokePool;
    address public immutable backupBot;

    constructor(address _recipient, uint256 _destinationChainId, address _acrossSpokePool, address _backupBot) {
        recipient = _recipient;
        destinationChainId = _destinationChainId;
        acrossSpokePool = _acrossSpokePool;
        backupBot = _backupBot;
    }

    // Triggered automatically when TenBridge (L1) releases the unlocked ETH
    receive() external payable {
        uint256 amountToBridge = msg.value;

        // 1. The Reimbursement Model
        // If the GhostHop Backup Bot fronted the L1 execution gas, refund it instantly.
        if (tx.origin == backupBot) {
            // Assume an upper bound of 400,000 gas for the entire L1 exit flow
            uint256 reimbursement = 400_000 * tx.gasprice;
            
            // Safety check: ensure gas spikes don't wipe out the user's principal
            if (reimbursement < amountToBridge) {
                payable(backupBot).transfer(reimbursement);
                amountToBridge -= reimbursement;
            }
        }

        // 2. Dynamic Across Quote (Smart Cap)
        // Accept a 0.5% fee to ensure Across relayers pick up the transaction instantly
        uint256 safetyFee = (amountToBridge * 50) / 10000;
        uint256 outputAmount = amountToBridge - safetyFee;

        // 3. Bridge to Destination Chain
        IAcrossSpokePool(acrossSpokePool).depositV3{value: amountToBridge}(
            address(this),                     // depositor
            recipient,                         // recipient on Destination Chain
            address(0),                        // inputToken (Native ETH)
            address(0),                        // outputToken (Native ETH)
            amountToBridge,                    // inputAmount
            outputAmount,                      // outputAmount
            destinationChainId,                // dynamically routes to Base, Arb, Opt, etc.
            address(0),                        // exclusiveRelayer
            uint32(block.timestamp),           // quoteTimestamp (Fresh)
            uint32(block.timestamp + 6 hours), // fillDeadline (Fresh)
            0,                                 // exclusivityDeadline
            ""                                 // message
        );
    }
}

contract GhostHopCatcherFactory {
    address public immutable acrossSpokePool;
    address public immutable backupBot;

    event CatcherDeployed(address indexed catcher, address indexed recipient, uint256 destinationChainId);

    constructor(address _acrossSpokePool, address _backupBot) {
        acrossSpokePool = _acrossSpokePool;
        backupBot = _backupBot;
    }

    // Deploys the Catcher contract to the deterministic address
    function deployCatcher(address recipient, uint256 destinationChainId) external returns (address) {
        bytes32 salt = keccak256(abi.encodePacked(recipient, destinationChainId));
        GhostHopCatcher catcher = new GhostHopCatcher{salt: salt}(recipient, destinationChainId, acrossSpokePool, backupBot);
        emit CatcherDeployed(address(catcher), recipient, destinationChainId);
        return address(catcher);
    }

    // Exposes the exact Create2 address formula so L2 Adapter can sync the InitCodeHash
    function getCatcherAddress(address recipient, uint256 destinationChainId) external view returns (address) {
        bytes32 salt = keccak256(abi.encodePacked(recipient, destinationChainId));
        return address(uint160(uint256(keccak256(abi.encodePacked(
            hex"ff",
            address(this),
            salt,
            keccak256(abi.encodePacked(
                type(GhostHopCatcher).creationCode,
                abi.encode(recipient, destinationChainId, acrossSpokePool, backupBot)
            ))
        )))));
    }
}
