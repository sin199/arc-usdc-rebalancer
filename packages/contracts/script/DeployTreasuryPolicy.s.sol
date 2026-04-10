// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BroadcastScript} from "../src/FoundrySupport.sol";
import {TreasuryPolicy} from "../src/TreasuryPolicy.sol";

contract DeployTreasuryPolicy is BroadcastScript {
    function run() external returns (TreasuryPolicy policy) {
        uint256 privateKey = VM.envUint("PRIVATE_KEY");
        uint256 minThreshold = VM.envUint("MIN_THRESHOLD_USDC") * 1e18;
        uint256 targetBalance = VM.envUint("TARGET_BALANCE_USDC") * 1e18;
        uint256 maxRebalanceAmount = VM.envUint("MAX_REBALANCE_AMOUNT_USDC") * 1e18;

        VM.startBroadcast(privateKey);
        policy = new TreasuryPolicy();
        policy.setPolicy(minThreshold, targetBalance, maxRebalanceAmount);
        VM.stopBroadcast();
    }
}
