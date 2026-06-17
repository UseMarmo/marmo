const HOSTS = ["https://api.usemarmo.xyz", "https://core-qe0y.onrender.com"];

let cachedBase: string | null = null;

function ordered(): string[] {
  return cachedBase ? [cachedBase, ...HOSTS.filter((h) => h !== cachedBase)] : [...HOSTS];
}

async function coreFetch(path: string, init?: RequestInit): Promise<Response> {
  for (const host of ordered()) {
    try {
      const res = await fetch(host + path, { ...init, signal: AbortSignal.timeout(12000) });
      cachedBase = host;
      return res;
    } catch {
      cachedBase = null;
    }
  }
  throw new Error("Marmo co-signer is unreachable");
}

export interface RegisterResult {
  shardBAddress: `0x${string}`;
  apiKey: string;
}

export interface WalletInfo {
  address: string;
  shardBAddress: `0x${string}`;
}

export async function getWalletInfo(address: string): Promise<WalletInfo> {
  const res = await coreFetch(`/v1/wallets/${address}`);
  if (!res.ok) throw new Error("Wallet not found on co-signer");
  return res.json() as Promise<WalletInfo>;
}

export async function registerWallet(
  address: string,
  shardAAddress: string,
  shardCAddress: string,
): Promise<RegisterResult> {
  const res = await coreFetch("/v1/wallets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, shardAAddress, shardCAddress }),
  });
  if (!res.ok) {
    const err = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(err.error ?? "Could not register wallet");
  }
  return res.json() as Promise<RegisterResult>;
}

export async function cosign(
  address: string,
  apiKey: string,
  userOpHash: `0x${string}`,
): Promise<`0x${string}`> {
  const res = await coreFetch(`/v1/wallets/${address}/cosign`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ userOpHash }),
  });
  const data = (await res.json().catch(() => ({}))) as { signature?: string; error?: string };
  if (!res.ok || !data.signature) throw new Error(data.error ?? "Co-signer declined to sign");
  return data.signature as `0x${string}`;
}

export interface SendCalldata {
  callData: `0x${string}`;
  value: string;
}

export async function buildSend(
  address: string,
  apiKey: string,
  to: string,
  amount: string,
  token?: string,
): Promise<SendCalldata> {
  const res = await coreFetch(`/v1/wallets/${address}/tx/send`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ to, amount, token }),
  });
  const data = (await res.json().catch(() => ({}))) as SendCalldata & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Failed to build send calldata");
  return data;
}

export interface StealthSendCalldata {
  callData: `0x${string}`;
  value: string;
  stealthAddress: string;
}

export async function buildStealthSend(
  address: string,
  apiKey: string,
  recipientMetaAddress: string,
  amount: string,
  token?: string,
): Promise<StealthSendCalldata> {
  const res = await coreFetch(`/v1/wallets/${address}/tx/stealth-send`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ recipientMetaAddress, amount, token }),
  });
  const data = (await res.json().catch(() => ({}))) as StealthSendCalldata & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Failed to build stealth send calldata");
  return data;
}

export interface QuoteResult {
  amountOut: string;
  feeTier: number;
}

export async function getQuote(
  tokenIn: string,
  tokenOut: string,
  amountIn: string,
): Promise<QuoteResult> {
  const params = new URLSearchParams({ tokenIn, tokenOut, amountIn });
  const res = await coreFetch(`/v1/quote?${params.toString()}`);
  const data = (await res.json().catch(() => ({}))) as QuoteResult & { error?: string };
  if (!res.ok) throw new Error(data.error ?? "Quote failed");
  return data;
}
