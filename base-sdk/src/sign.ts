import { privateKeyToAccount } from "viem/accounts";
import { hexToBytes } from "viem";

export async function signUserOp(
  privateKey: `0x${string}`,
  userOpHash: `0x${string}`
): Promise<`0x${string}`> {
  const account = privateKeyToAccount(privateKey);
  return account.signMessage({ message: { raw: hexToBytes(userOpHash) } });
}

export function combineSignatures(
  sigA: `0x${string}`,
  sigB: `0x${string}`
): `0x${string}` {
  if (sigA.length !== 132 || sigB.length !== 132) {
    throw new Error("each signature must be 65 bytes (132 hex chars including 0x prefix)");
  }
  return `0x${sigA.slice(2)}${sigB.slice(2)}`;
}
