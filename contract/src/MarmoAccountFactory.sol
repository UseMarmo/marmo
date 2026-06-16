// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {MarmoAccount} from "./MarmoAccount.sol";

contract MarmoAccountFactory {
    IEntryPoint public immutable entryPoint;

    event AccountCreated(address indexed account, address[3] owners, uint256 salt);

    constructor(IEntryPoint _entryPoint) {
        entryPoint = _entryPoint;
    }

    function createAccount(
        address[3] calldata owners,
        uint256 salt
    ) external returns (MarmoAccount account) {
        address predicted = predictAddress(owners, salt);

        if (predicted.code.length > 0) return MarmoAccount(payable(predicted));

        account = new MarmoAccount{salt: bytes32(salt)}(entryPoint, owners);
        emit AccountCreated(address(account), owners, salt);
    }

    function predictAddress(
        address[3] calldata owners,
        uint256 salt
    ) public view returns (address) {
        bytes memory bytecode = abi.encodePacked(
            type(MarmoAccount).creationCode,
            abi.encode(address(entryPoint), owners)
        );
        bytes32 hash = keccak256(
            abi.encodePacked(bytes1(0xff), address(this), bytes32(salt), keccak256(bytecode))
        );
        return address(uint160(uint256(hash)));
    }
}
