// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract TreasuryPolicyV2 {
    address public owner;
    address public pendingOwner;

    uint256 public minThreshold;
    uint256 public targetBalance;
    uint256 public maxRebalanceAmount;

    event OwnershipTransferStarted(address indexed owner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event PolicyUpdated(
        address indexed owner,
        uint256 minThreshold,
        uint256 targetBalance,
        uint256 maxRebalanceAmount
    );

    error InvalidOwner();
    error InvalidPolicy();
    error NotOwner();
    error NotPendingOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(
        address initialOwner,
        uint256 initialMinThreshold,
        uint256 initialTargetBalance,
        uint256 initialMaxRebalanceAmount
    ) {
        if (initialOwner == address(0)) revert InvalidOwner();

        owner = initialOwner;
        _setPolicy(initialMinThreshold, initialTargetBalance, initialMaxRebalanceAmount);
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function setPolicy(
        uint256 newMinThreshold,
        uint256 newTargetBalance,
        uint256 newMaxRebalanceAmount
    ) external onlyOwner {
        _setPolicy(newMinThreshold, newTargetBalance, newMaxRebalanceAmount);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0) || newOwner == owner) revert InvalidOwner();

        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    function acceptOwnership() external {
        if (msg.sender != pendingOwner) revert NotPendingOwner();

        address previousOwner = owner;
        owner = msg.sender;
        pendingOwner = address(0);
        emit OwnershipTransferred(previousOwner, msg.sender);
    }

    function getPolicy()
        external
        view
        returns (
            uint256 currentMinThreshold,
            uint256 currentTargetBalance,
            uint256 currentMaxRebalanceAmount
        )
    {
        return (minThreshold, targetBalance, maxRebalanceAmount);
    }

    function _setPolicy(
        uint256 newMinThreshold,
        uint256 newTargetBalance,
        uint256 newMaxRebalanceAmount
    ) internal {
        if (
            newTargetBalance < newMinThreshold || newMaxRebalanceAmount == 0
                || newMaxRebalanceAmount > newTargetBalance
        ) {
            revert InvalidPolicy();
        }

        minThreshold = newMinThreshold;
        targetBalance = newTargetBalance;
        maxRebalanceAmount = newMaxRebalanceAmount;

        emit PolicyUpdated(owner, newMinThreshold, newTargetBalance, newMaxRebalanceAmount);
    }
}
