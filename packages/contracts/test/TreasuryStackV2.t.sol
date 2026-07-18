// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import { Vm } from "../src/FoundrySupport.sol";
import { TreasuryExecutorV2 } from "../src/TreasuryExecutorV2.sol";
import { TreasuryPolicyV2 } from "../src/TreasuryPolicyV2.sol";

contract MockUsdcV2 {
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transfer(address recipient, uint256 amount) external returns (bool) {
        if (balanceOf[msg.sender] < amount) return false;
        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount)
        external
        returns (bool)
    {
        uint256 approved = allowance[sender][msg.sender];
        if (approved < amount || balanceOf[sender] < amount) return false;
        allowance[sender][msg.sender] = approved - amount;
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }
}

contract TreasuryStackV2Test {
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
    uint256 private constant USDC = 1e6;

    MockUsdcV2 private token;
    TreasuryPolicyV2 private policy;
    TreasuryExecutorV2 private executor;
    address private recipient = address(0xBEEF);
    address private nextOwner = address(0xCAFE);

    function setUp() public {
        token = new MockUsdcV2();
        policy = new TreasuryPolicyV2(address(this), 100 * USDC, 500 * USDC, 200 * USDC);
        executor =
            new TreasuryExecutorV2(address(token), address(policy), address(this), 150 * USDC);
    }

    function testTopUpEnforcesPolicyAndExecutorCaps() public {
        token.mint(address(this), 1_000 * USDC);
        token.approve(address(executor), 500 * USDC);

        bool reverted;
        try executor.executeTopUp(151 * USDC) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "executor cap should block top-up");

        executor.executeTopUp(100 * USDC);
        require(token.balanceOf(address(executor)) == 100 * USDC, "top-up balance mismatch");

        try executor.executeTopUp(1 * USDC) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "policy should block top-up at minimum");
    }

    function testTrimRequiresAllowlistAndOnlyMovesExcess() public {
        token.mint(address(executor), 600 * USDC);

        bool reverted;
        try executor.executeTrim(recipient, 100 * USDC) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "recipient allowlist should block trim");

        executor.setRecipientAllowed(recipient, true);

        try executor.executeTrim(recipient, 101 * USDC) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "target excess should cap trim");

        executor.executeTrim(recipient, 100 * USDC);
        require(token.balanceOf(recipient) == 100 * USDC, "recipient balance mismatch");
        require(token.balanceOf(address(executor)) == 500 * USDC, "executor target mismatch");
    }

    function testPauseBlocksExecution() public {
        token.mint(address(this), 1_000 * USDC);
        token.approve(address(executor), 100 * USDC);
        executor.setPaused(true);

        bool reverted;
        try executor.executeTopUp(100 * USDC) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "paused executor should block execution");
    }

    function testTwoStepOwnershipTransfer() public {
        policy.transferOwnership(nextOwner);
        executor.transferOwnership(nextOwner);

        VM.prank(nextOwner);
        policy.acceptOwnership();
        VM.prank(nextOwner);
        executor.acceptOwnership();

        require(policy.owner() == nextOwner, "policy owner mismatch");
        require(executor.owner() == nextOwner, "executor owner mismatch");
    }

    function testNonOwnerCannotChangeSafetyControls() public {
        VM.prank(recipient);
        bool reverted;
        try executor.setPaused(true) {
            reverted = false;
        } catch {
            reverted = true;
        }
        require(reverted, "non-owner pause should revert");
    }
}
