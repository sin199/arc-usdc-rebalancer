// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @notice Stores immutable hashes of reviewed treasury decisions. This contract never holds or moves assets.
contract TreasuryDecisionReceipt {
    struct Receipt {
        address recorder;
        uint8 action;
        uint256 observedAt;
        uint256 recordedAt;
    }

    address public owner;
    address public pendingOwner;
    mapping(bytes32 => Receipt) private receipts;

    event OwnershipTransferStarted(address indexed owner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event ReceiptRecorded(
        bytes32 indexed receiptHash,
        address indexed recorder,
        uint8 action,
        uint256 observedAt,
        uint256 recordedAt
    );

    error DuplicateReceipt();
    error InvalidAction();
    error InvalidAddress();
    error InvalidReceipt();
    error NotOwner();
    error NotPendingOwner();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    constructor(address initialOwner) {
        if (initialOwner == address(0)) revert InvalidAddress();
        owner = initialOwner;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function recordReceipt(bytes32 receiptHash, uint8 action, uint256 observedAt) external onlyOwner {
        if (receiptHash == bytes32(0) || observedAt == 0) revert InvalidReceipt();
        if (action > 3) revert InvalidAction();
        if (receipts[receiptHash].recordedAt != 0) revert DuplicateReceipt();

        receipts[receiptHash] = Receipt({
            recorder: msg.sender,
            action: action,
            observedAt: observedAt,
            recordedAt: block.timestamp
        });
        emit ReceiptRecorded(receiptHash, msg.sender, action, observedAt, block.timestamp);
    }

    function getReceipt(bytes32 receiptHash) external view returns (Receipt memory) {
        return receipts[receiptHash];
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0) || newOwner == owner) revert InvalidAddress();
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
}
