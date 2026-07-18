// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { BroadcastScript } from "../src/FoundrySupport.sol";
import { TreasuryExecutorV2 } from "../src/TreasuryExecutorV2.sol";
import { TreasuryPolicyV2 } from "../src/TreasuryPolicyV2.sol";

contract DeployTreasuryStackV2 is BroadcastScript {
    function run() external returns (TreasuryPolicyV2 policy, TreasuryExecutorV2 executor) {
        uint256 privateKey = VM.envUint("PRIVATE_KEY");
        address initialOwner = VM.addr(privateKey);
        address usdc = 0x3600000000000000000000000000000000000000;
        uint256 minThreshold = VM.envUint("MIN_THRESHOLD_USDC") * 1e6;
        uint256 targetBalance = VM.envUint("TARGET_BALANCE_USDC") * 1e6;
        uint256 maxRebalanceAmount = VM.envUint("MAX_REBALANCE_AMOUNT_USDC") * 1e6;
        uint256 executorMaxAmount = VM.envUint("EXECUTOR_MAX_AMOUNT_USDC") * 1e6;

        VM.startBroadcast(privateKey);
        policy = new TreasuryPolicyV2(initialOwner, minThreshold, targetBalance, maxRebalanceAmount);
        executor = new TreasuryExecutorV2(usdc, address(policy), initialOwner, executorMaxAmount);
        VM.stopBroadcast();
    }
}
