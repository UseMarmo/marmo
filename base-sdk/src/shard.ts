import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";

export interface Shard {
  address: `0x${string}`;
  privateKey: `0x${string}`;
}

export function generateShard(): Shard {
  const privateKey = generatePrivateKey();
  return { address: privateKeyToAddress(privateKey), privateKey };
}

export function exportShard(shard: Shard): string {
  return JSON.stringify({ address: shard.address, privateKey: shard.privateKey });
}

export function importShard(json: string): Shard {
  const parsed = JSON.parse(json) as { address?: unknown; privateKey?: unknown };
  if (typeof parsed.address !== "string" || typeof parsed.privateKey !== "string") {
    throw new Error("invalid shard: missing address or privateKey");
  }
  return { address: parsed.address as `0x${string}`, privateKey: parsed.privateKey as `0x${string}` };
}
