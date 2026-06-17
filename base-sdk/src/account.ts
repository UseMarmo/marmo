import { createPublicClient, http, parseAbi } from "viem";
import { base } from "viem/chains";

const FACTORY_ABI = parseAbi([
  "function predictAddress(address[3] owners, uint256 salt) view returns (address)",
]);

export interface PredictAddressOptions {
  factory: `0x${string}`;
  salt?: bigint;
  rpcUrl?: string;
}

export async function predictAddress(
  owners: [`0x${string}`, `0x${string}`, `0x${string}`],
  options: PredictAddressOptions
): Promise<`0x${string}`> {
  const client = createPublicClient({
    chain: base,
    transport: http(options.rpcUrl),
  });

  return client.readContract({
    address: options.factory,
    abi: FACTORY_ABI,
    functionName: "predictAddress",
    args: [owners, options.salt ?? 0n],
  }) as Promise<`0x${string}`>;
}
