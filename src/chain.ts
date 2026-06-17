import { createPublicClient, http, parseAbiItem } from "viem";
import { base, baseSepolia } from "viem/chains";

const NETWORK = process.env.MARMO_NETWORK ?? "base-sepolia";

export { NETWORK };

export const publicClient = createPublicClient({
  chain: NETWORK === "base" ? base : baseSepolia,
  transport: http(process.env.BASE_RPC ?? undefined),
});

export const ERC5564_ANNOUNCER = "0x55649E01B5Df198D18D95b5cc5051630cfD45564" as const;

const ANNOUNCEMENT_EVENT = parseAbiItem(
  "event Announcement(uint256 indexed schemeId, address indexed stealthAddress, address indexed caller, bytes ephemeralPubKey, bytes metadata)"
);

const SCHEME_ID = 0n;
const MAX_BLOCK_RANGE = 10_000n;

export interface RawAnnouncement {
  stealthAddress: string;
  ephemeralPubKey: string;
  viewTag: number;
  blockNumber: string;
  txHash: string;
}

export async function getAnnouncements(fromBlock: bigint, toBlock: bigint): Promise<RawAnnouncement[]> {
  if (toBlock - fromBlock > MAX_BLOCK_RANGE) {
    throw new Error(`block range exceeds maximum of ${MAX_BLOCK_RANGE}`);
  }

  const logs = await publicClient.getLogs({
    address: ERC5564_ANNOUNCER,
    event: ANNOUNCEMENT_EVENT,
    args: { schemeId: SCHEME_ID },
    fromBlock,
    toBlock,
  });

  return logs.map((log) => ({
    stealthAddress: (log.args.stealthAddress ?? "").toLowerCase(),
    ephemeralPubKey: (log.args.ephemeralPubKey as string) ?? "0x",
    viewTag: parseInt(((log.args.metadata as string) ?? "0x00").slice(2, 4), 16),
    blockNumber: (log.blockNumber ?? 0n).toString(),
    txHash: log.transactionHash ?? "",
  }));
}

export async function getLatestBlock(): Promise<bigint> {
  return publicClient.getBlockNumber();
}
