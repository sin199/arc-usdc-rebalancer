// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract TreasuryPolicy {
    address public owner;

    uint256 public minThreshold;
    uint256 public targetBalance;
    uint256 public maxRebalanceAmount;

    event PolicyUpdated(
        address indexed owner,
        uint256 minThreshold,
        uint256 targetBalance,
        uint256 maxRebalanceAmount
    );

    error NotOwner();
    error InvalidPolicy();

    modifier onlyOwner() {
        _checkOwner();
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function setPolicy(
        uint256 newMinThreshold,
        uint256 newTargetBalance,
        uint256 newMaxRebalanceAmount
    ) external onlyOwner {
        if (newTargetBalance < newMinThreshold) {
            revert InvalidPolicy();
        }

        minThreshold = newMinThreshold;
        targetBalance = newTargetBalance;
        maxRebalanceAmount = newMaxRebalanceAmount;

        emit PolicyUpdated(msg.sender, newMinThreshold, newTargetBalance, newMaxRebalanceAmount);
    }

    function _checkOwner() internal view {
        if (msg.sender != owner) {
            revert NotOwner();
        }
    }

    function getPolicy()
        external
        view
        returns (uint256 currentMinThreshold, uint256 currentTargetBalance, uint256 currentMaxRebalanceAmount)
    {
        return (minThreshold, targetBalance, maxRebalanceAmount);
    }
}
