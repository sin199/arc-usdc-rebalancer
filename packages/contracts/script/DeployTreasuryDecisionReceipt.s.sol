// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {BroadcastScript} from "../src/FoundrySupport.sol";
import {TreasuryDecisionReceipt} from "../src/TreasuryDecisionReceipt.sol";

contract DeployTreasuryDecisionReceipt is BroadcastScript {
    function run() external returns (TreasuryDecisionReceipt receiptRegistry) {
        uint256 privateKey = VM.envUint("PRIVATE_KEY");

        VM.startBroadcast(privateKey);
        receiptRegistry = new TreasuryDecisionReceipt(VM.addr(privateKey));
        VM.stopBroadcast();
    }
}
