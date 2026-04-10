// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "../src/FoundrySupport.sol";
import {TreasuryPolicy} from "../src/TreasuryPolicy.sol";

contract TreasuryPolicyTest {
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    TreasuryPolicy private policy;
    address private other = address(0xBEEF);

    function setUp() public {
        policy = new TreasuryPolicy();
    }

    function testOwnerCanSetPolicy() public {
        policy.setPolicy(100, 500, 200);

        (uint256 minThreshold, uint256 targetBalance, uint256 maxRebalanceAmount) = policy.getPolicy();

        require(minThreshold == 100, "min threshold mismatch");
        require(targetBalance == 500, "target balance mismatch");
        require(maxRebalanceAmount == 200, "max rebalance mismatch");
    }

    function testNonOwnerCannotSetPolicy() public {
        VM.prank(other);

        bool reverted;
        try policy.setPolicy(100, 500, 200) {
            reverted = false;
        } catch {
            reverted = true;
        }

        require(reverted, "non-owner call should revert");
    }

    function testGetPolicyReturnsLatestValues() public {
        policy.setPolicy(250, 900, 300);

        (uint256 minThreshold, uint256 targetBalance, uint256 maxRebalanceAmount) = policy.getPolicy();

        require(minThreshold == 250, "min threshold mismatch");
        require(targetBalance == 900, "target balance mismatch");
        require(maxRebalanceAmount == 300, "max rebalance mismatch");
    }
}
