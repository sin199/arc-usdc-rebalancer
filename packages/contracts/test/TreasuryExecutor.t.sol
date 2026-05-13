// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {Vm} from "../src/FoundrySupport.sol";
import {TreasuryExecutor} from "../src/TreasuryExecutor.sol";

contract MockERC20 {
    string public name = "Mock USDC";
    string public symbol = "mUSDC";
    uint8 public decimals = 18;

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
        if (balanceOf[msg.sender] < amount) {
            return false;
        }

        balanceOf[msg.sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }

    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool) {
        uint256 approved = allowance[sender][msg.sender];
        if (approved < amount || balanceOf[sender] < amount) {
            return false;
        }

        allowance[sender][msg.sender] = approved - amount;
        balanceOf[sender] -= amount;
        balanceOf[recipient] += amount;
        return true;
    }
}

contract TreasuryExecutorTest {
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));

    MockERC20 private token;
    TreasuryExecutor private executor;
    address private other = address(0xBEEF);

    function setUp() public {
        token = new MockERC20();
        executor = new TreasuryExecutor(address(token));
    }

    function testOwnerCanExecuteTopUpWithAllowance() public {
        token.mint(address(this), 1_000e18);
        token.approve(address(executor), 250e18);

        executor.executeTopUp(250e18);

        require(token.balanceOf(address(this)) == 750e18, "owner balance mismatch");
        require(token.balanceOf(address(executor)) == 250e18, "executor balance mismatch");
    }

    function testOwnerCanExecuteTrimToRecipient() public {
        token.mint(address(executor), 500e18);

        executor.executeTrim(other, 125e18);

        require(token.balanceOf(other) == 125e18, "recipient balance mismatch");
        require(token.balanceOf(address(executor)) == 375e18, "executor balance mismatch");
    }

    function testNonOwnerCannotExecute() public {
        VM.prank(other);

        bool reverted;
        try executor.executeTopUp(1e18) {
            reverted = false;
        } catch {
            reverted = true;
        }

        require(reverted, "non-owner call should revert");
    }

    function testTopUpWithoutAllowanceFails() public {
        token.mint(address(this), 1_000e18);

        bool reverted;
        try executor.executeTopUp(1e18) {
            reverted = false;
        } catch {
            reverted = true;
        }

        require(reverted, "missing allowance should revert");
    }
}
