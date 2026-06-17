import { NETWORK } from "./chain.js";

const REGISTRY: Record<string, Record<string, `0x${string}`>> = {
  base: {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    USDT: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
  },
  "base-sepolia": {
    WETH: "0x4200000000000000000000000000000000000006",
    USDC: "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
  },
};

export function resolveToken(symbolOrAddress: string): `0x${string}` {
  if (symbolOrAddress.startsWith("0x")) return symbolOrAddress as `0x${string}`;
  const addr = REGISTRY[NETWORK]?.[symbolOrAddress.toUpperCase()];
  if (!addr) throw new Error(`unknown token "${symbolOrAddress}" on ${NETWORK}`);
  return addr;
}

export function listTokens(): Record<string, string> {
  return { ...REGISTRY[NETWORK] };
}
