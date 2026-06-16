import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";

export type MarmoNetwork = "mainnet" | "testnet" | "devnet" | "localnet";

export function createClient(network: MarmoNetwork = "testnet"): SuiClient {
  return new SuiClient({ url: getFullnodeUrl(network) });
}
