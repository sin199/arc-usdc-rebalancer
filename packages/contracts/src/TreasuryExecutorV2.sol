// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IERC20TreasuryAsset {
    function allowance(address owner, address spender) external view returns (uint256);

    function balanceOf(address account) external view returns (uint256);
}

interface ITreasuryPolicyView {
    function getPolicy()
        external
        view
        returns (uint256 minThreshold, uint256 targetBalance, uint256 maxRebalanceAmount);
}

contract TreasuryExecutorV2 {
    address public owner;
    address public pendingOwner;
    IERC20TreasuryAsset public immutable asset;
    ITreasuryPolicyView public policy;
    uint256 public executorMaxAmount;
    bool public paused;

    mapping(address => bool) public allowedRecipient;

    bool private entered;

    event ExecutorMaxAmountUpdated(uint256 previousAmount, uint256 newAmount);
    event OwnershipTransferStarted(address indexed owner, address indexed pendingOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);
    event Paused(address indexed owner);
    event PolicyUpdated(address indexed previousPolicy, address indexed newPolicy);
    event RecipientPermissionUpdated(address indexed recipient, bool allowed);
    event TopUpExecuted(address indexed owner, uint256 amount, uint256 balanceAfter);
    event TrimExecuted(
        address indexed owner, address indexed recipient, uint256 amount, uint256 balanceAfter
    );
    event Unpaused(address indexed owner);

    error AmountExceedsLimit();
    error InsufficientAllowance();
    error InvalidAddress();
    error InvalidAmount();
    error NotOwner();
    error NotPendingOwner();
    error PausedExecution();
    error PolicyActionNotRequired();
    error RecipientNotAllowed();
    error ReentrantCall();
    error TransferFailed();

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier nonReentrant() {
        if (entered) revert ReentrantCall();
        entered = true;
        _;
        entered = false;
    }

    modifier whenNotPaused() {
        if (paused) revert PausedExecution();
        _;
    }

    constructor(
        address asset_,
        address policy_,
        address initialOwner,
        uint256 initialExecutorMaxAmount
    ) {
        if (
            asset_ == address(0) || policy_ == address(0) || initialOwner == address(0)
                || initialExecutorMaxAmount == 0
        ) {
            revert InvalidAddress();
        }

        asset = IERC20TreasuryAsset(asset_);
        policy = ITreasuryPolicyView(policy_);
        owner = initialOwner;
        executorMaxAmount = initialExecutorMaxAmount;
        emit OwnershipTransferred(address(0), initialOwner);
    }

    function executeTopUp(uint256 amount) external onlyOwner whenNotPaused nonReentrant {
        if (amount == 0) revert InvalidAmount();

        (uint256 minThreshold, uint256 targetBalance, uint256 policyMaxAmount) = policy.getPolicy();
        uint256 balanceBefore = asset.balanceOf(address(this));
        if (balanceBefore >= minThreshold) revert PolicyActionNotRequired();

        uint256 targetGap = targetBalance - balanceBefore;
        if (amount > _min(_min(policyMaxAmount, executorMaxAmount), targetGap)) {
            revert AmountExceedsLimit();
        }

        if (asset.allowance(msg.sender, address(this)) < amount) revert InsufficientAllowance();
        _safeTransferFrom(msg.sender, address(this), amount);

        emit TopUpExecuted(msg.sender, amount, asset.balanceOf(address(this)));
    }

    function executeTrim(address recipient, uint256 amount)
        external
        onlyOwner
        whenNotPaused
        nonReentrant
    {
        if (recipient == address(0)) revert InvalidAddress();
        if (!allowedRecipient[recipient]) revert RecipientNotAllowed();
        if (amount == 0) revert InvalidAmount();

        (, uint256 targetBalance, uint256 policyMaxAmount) = policy.getPolicy();
        uint256 balanceBefore = asset.balanceOf(address(this));
        if (balanceBefore <= targetBalance) revert PolicyActionNotRequired();

        uint256 excessBalance = balanceBefore - targetBalance;
        if (amount > _min(_min(policyMaxAmount, executorMaxAmount), excessBalance)) {
            revert AmountExceedsLimit();
        }

        _safeTransfer(recipient, amount);
        emit TrimExecuted(msg.sender, recipient, amount, asset.balanceOf(address(this)));
    }

    function setPaused(bool nextPaused) external onlyOwner {
        paused = nextPaused;
        if (nextPaused) {
            emit Paused(msg.sender);
        } else {
            emit Unpaused(msg.sender);
        }
    }

    function setRecipientAllowed(address recipient, bool allowed) external onlyOwner {
        if (recipient == address(0)) revert InvalidAddress();

        allowedRecipient[recipient] = allowed;
        emit RecipientPermissionUpdated(recipient, allowed);
    }

    function setExecutorMaxAmount(uint256 newAmount) external onlyOwner {
        if (newAmount == 0) revert InvalidAmount();

        uint256 previousAmount = executorMaxAmount;
        executorMaxAmount = newAmount;
        emit ExecutorMaxAmountUpdated(previousAmount, newAmount);
    }

    function setPolicy(address newPolicy) external onlyOwner {
        if (newPolicy == address(0)) revert InvalidAddress();

        address previousPolicy = address(policy);
        policy = ITreasuryPolicyView(newPolicy);
        emit PolicyUpdated(previousPolicy, newPolicy);
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

    function _safeTransfer(address recipient, uint256 amount) internal {
        (bool success, bytes memory result) = address(asset)
            .call(abi.encodeWithSignature("transfer(address,uint256)", recipient, amount));
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert TransferFailed();
        }
    }

    function _safeTransferFrom(address sender, address recipient, uint256 amount) internal {
        (bool success, bytes memory result) = address(asset)
            .call(
                abi.encodeWithSignature(
                    "transferFrom(address,address,uint256)", sender, recipient, amount
                )
            );
        if (!success || (result.length != 0 && !abi.decode(result, (bool)))) {
            revert TransferFailed();
        }
    }

    function _min(uint256 left, uint256 right) internal pure returns (uint256) {
        return left < right ? left : right;
    }
}
