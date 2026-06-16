// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAccount} from "@account-abstraction/contracts/interfaces/IAccount.sol";
import {PackedUserOperation} from "@account-abstraction/contracts/interfaces/PackedUserOperation.sol";
import {IEntryPoint} from "@account-abstraction/contracts/interfaces/IEntryPoint.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {MessageHashUtils} from "@openzeppelin/contracts/utils/cryptography/MessageHashUtils.sol";

contract MarmoAccount is IAccount {
    using ECDSA for bytes32;

    IEntryPoint public immutable entryPoint;
    address[3] public owners;

    error NotEntryPoint();
    error InvalidSignatureLength();
    error DuplicateSigner();
    error PrefundFailed();
    error CallFailed(bytes reason);

    constructor(IEntryPoint _entryPoint, address[3] memory _owners) {
        entryPoint = _entryPoint;
        owners = _owners;
    }

    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData) {
        if (msg.sender != address(entryPoint)) revert NotEntryPoint();

        if (missingAccountFunds > 0) {
            (bool ok,) = payable(address(entryPoint)).call{value: missingAccountFunds}("");
            if (!ok) revert PrefundFailed();
        }

        bytes memory sig = userOp.signature;
        if (sig.length != 130) revert InvalidSignatureLength();

        bytes32 ethHash = MessageHashUtils.toEthSignedMessageHash(userOpHash);

        bytes memory sig1 = new bytes(65);
        bytes memory sig2 = new bytes(65);
        for (uint256 i = 0; i < 65; i++) {
            sig1[i] = sig[i];
            sig2[i] = sig[65 + i];
        }

        address signer1 = ECDSA.recover(ethHash, sig1);
        address signer2 = ECDSA.recover(ethHash, sig2);

        if (signer1 == signer2) revert DuplicateSigner();

        uint256 validCount = 0;
        for (uint256 i = 0; i < 3; i++) {
            if (owners[i] == signer1 || owners[i] == signer2) validCount++;
        }

        return validCount >= 2 ? 0 : 1;
    }

    function execute(address dest, uint256 value, bytes calldata data) external {
        if (msg.sender != address(entryPoint)) revert NotEntryPoint();
        (bool ok, bytes memory result) = dest.call{value: value}(data);
        if (!ok) revert CallFailed(result);
    }

    function executeBatch(
        address[] calldata dest,
        uint256[] calldata values,
        bytes[] calldata data
    ) external {
        if (msg.sender != address(entryPoint)) revert NotEntryPoint();
        for (uint256 i = 0; i < dest.length; i++) {
            uint256 val = values.length > i ? values[i] : 0;
            (bool ok, bytes memory result) = dest[i].call{value: val}(data[i]);
            if (!ok) revert CallFailed(result);
        }
    }

    receive() external payable {}
}
