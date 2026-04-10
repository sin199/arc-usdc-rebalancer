// SPDX-License-Identifier: MIT
// Minimal Foundry cheatcode bindings so the contract package stays dependency-free.
pragma solidity ^0.8.24;

interface Vm {
    function envUint(string calldata name) external returns (uint256);

    function startBroadcast(uint256 privateKey) external;

    function stopBroadcast() external;

    function prank(address newSender) external;

    function expectEmit(bool checkTopic1, bool checkTopic2, bool checkTopic3, bool checkData) external;
}

abstract contract BroadcastScript {
    Vm internal constant VM = Vm(address(uint160(uint256(keccak256("hevm cheat code")))));
}
