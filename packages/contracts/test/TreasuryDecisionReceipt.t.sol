// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "../src/FoundrySupport.sol";
import {TreasuryDecisionReceipt} from "../src/TreasuryDecisionReceipt.sol";

contract TreasuryDecisionReceiptTest {
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    TreasuryDecisionReceipt private receiptRegistry;
    address private other = address(0xBEEF);
    bytes32 private receiptHash = keccak256("receipt");

    function setUp() public {
        receiptRegistry = new TreasuryDecisionReceipt(address(this));
    }

    function testOwnerRecordsImmutableReceipt() public {
        receiptRegistry.recordReceipt(receiptHash, 1, 1_784_556_000);

        TreasuryDecisionReceipt.Receipt memory receipt = receiptRegistry.getReceipt(receiptHash);
        require(receipt.recorder == address(this), "recorder mismatch");
        require(receipt.action == 1, "action mismatch");
        require(receipt.observedAt == 1_784_556_000, "observed timestamp mismatch");
        require(receipt.recordedAt > 0, "missing recorded timestamp");
    }

    function testNonOwnerCannotRecordReceipt() public {
        VM.prank(other);

        bool reverted;
        try receiptRegistry.recordReceipt(receiptHash, 1, 1_784_556_000) {
            reverted = false;
        } catch {
            reverted = true;
        }

        require(reverted, "non-owner receipt write should revert");
    }

    function testDuplicateAndInvalidReceiptsFail() public {
        receiptRegistry.recordReceipt(receiptHash, 1, 1_784_556_000);

        bool duplicateReverted;
        try receiptRegistry.recordReceipt(receiptHash, 1, 1_784_556_000) {
            duplicateReverted = false;
        } catch {
            duplicateReverted = true;
        }
        require(duplicateReverted, "duplicate receipt should revert");

        bool actionReverted;
        try receiptRegistry.recordReceipt(keccak256("invalid-action"), 4, 1_784_556_000) {
            actionReverted = false;
        } catch {
            actionReverted = true;
        }
        require(actionReverted, "invalid action should revert");
    }
}
