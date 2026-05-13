// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20 {
    function allowance(address owner, address spender) external view returns (uint256);

    function transfer(address recipient, uint256 amount) external returns (bool);

    function transferFrom(address sender, address recipient, uint256 amount) external returns (bool);
}

contract TreasuryExecutor {
    address public owner;
    IERC20 public immutable asset;

    event TopUpExecuted(address indexed owner, uint256 amount);
    event TrimExecuted(address indexed owner, address indexed recipient, uint256 amount);

    error InsufficientAllowance();
    error InvalidRecipient();
    error NotOwner();
    error TransferFailed();
    error ZeroAmount();

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    constructor(address asset_) {
        owner = msg.sender;
        asset = IERC20(asset_);
    }

    function executeTopUp(uint256 amount) external onlyOwner {
        if (amount == 0) {
            revert ZeroAmount();
        }

        if (asset.allowance(msg.sender, address(this)) < amount) {
            revert InsufficientAllowance();
        }

        if (!asset.transferFrom(msg.sender, address(this), amount)) {
            revert TransferFailed();
        }

        emit TopUpExecuted(msg.sender, amount);
    }

    function executeTrim(address recipient, uint256 amount) external onlyOwner {
        if (amount == 0) {
            revert ZeroAmount();
        }

        if (recipient == address(0)) {
            revert InvalidRecipient();
        }

        if (!asset.transfer(recipient, amount)) {
            revert TransferFailed();
        }

        emit TrimExecuted(msg.sender, recipient, amount);
    }

    function _checkOwner() internal view {
        if (msg.sender != owner) {
            revert NotOwner();
        }
    }
}
