import { encodeFunctionData, parseAbi } from "viem";
import { ERC5564_ANNOUNCER } from "./chain.js";
import { computeStealthAddress, parseMetaAddress } from "./stealth.js";
import { resolveToken } from "./tokens.js";

const ACCOUNT_ABI = parseAbi([
  "function execute(address dest, uint256 value, bytes data) external",
  "function executeBatch(address[] dest, uint256[] values, bytes[] data) external",
]);

const ERC20_ABI = parseAbi([
  "function transfer(address to, uint256 amount) returns (bool)",
]);

const ANNOUNCER_ABI = parseAbi([
  "function announce(uint256 schemeId, address stealthAddress, bytes ephemeralPubKey, bytes metadata) external",
]);

export function buildSendCalldata(params: {
  to: `0x${string}`;
  amount: bigint;
  token?: string;
}): { callData: `0x${string}`; value: bigint } {
  const isEth = !params.token || params.token.toUpperCase() === "ETH";

  if (isEth) {
    return {
      callData: encodeFunctionData({
        abi: ACCOUNT_ABI,
        functionName: "execute",
        args: [params.to, params.amount, "0x"],
      }),
      value: params.amount,
    };
  }

  const tokenAddr = resolveToken(params.token!);
  return {
    callData: encodeFunctionData({
      abi: ACCOUNT_ABI,
      functionName: "execute",
      args: [
        tokenAddr,
        0n,
        encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [params.to, params.amount] }),
      ],
    }),
    value: 0n,
  };
}

export function buildStealthSendCalldata(params: {
  recipientMetaAddress: string;
  amount: bigint;
  token?: string;
}): {
  callData: `0x${string}`;
  value: bigint;
  stealthAddress: `0x${string}`;
  ephemeralPubKey: `0x${string}`;
  viewTag: number;
} {
  const meta = parseMetaAddress(params.recipientMetaAddress);
  const { stealthAddress, ephemeralPubKey, viewTag } = computeStealthAddress(meta);

  const isEth = !params.token || params.token.toUpperCase() === "ETH";
  const transferDest = isEth ? stealthAddress : resolveToken(params.token!);
  const transferValue = isEth ? params.amount : 0n;
  const transferData: `0x${string}` = isEth
    ? "0x"
    : encodeFunctionData({ abi: ERC20_ABI, functionName: "transfer", args: [stealthAddress, params.amount] });

  const viewTagHex = `0x${viewTag.toString(16).padStart(2, "0")}` as `0x${string}`;
  const announceData = encodeFunctionData({
    abi: ANNOUNCER_ABI,
    functionName: "announce",
    args: [0n, stealthAddress, ephemeralPubKey, viewTagHex],
  });

  return {
    callData: encodeFunctionData({
      abi: ACCOUNT_ABI,
      functionName: "executeBatch",
      args: [
        [transferDest, ERC5564_ANNOUNCER],
        [transferValue, 0n],
        [transferData, announceData],
      ],
    }),
    value: transferValue,
    stealthAddress,
    ephemeralPubKey,
    viewTag,
  };
}
