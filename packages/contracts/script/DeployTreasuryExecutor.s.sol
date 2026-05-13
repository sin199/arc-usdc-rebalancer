// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BroadcastScript} from "../src/FoundrySupport.sol";
import {TreasuryExecutor} from "../src/TreasuryExecutor.sol";

contract DeployTreasuryExecutor is BroadcastScript {
    function run() external returns (TreasuryExecutor executor) {
        uint256 privateKey = VM.envUint("PRIVATE_KEY");
        address usdc = 0x3600000000000000000000000000000000000000;

        VM.startBroadcast(privateKey);
        executor = new TreasuryExecutor(usdc);
        VM.stopBroadcast();
    }
}
