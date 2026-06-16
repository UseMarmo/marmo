const HOSTS = ["https://api.usemarmo.xyz", "https://core-qe0y.onrender.com"];

let cachedBase: string | null = null;

function ordered(): string[] {
  return cachedBase ? [cachedBase, ...HOSTS.filter((h) => h !== cachedBase)] : [...HOSTS];
}

async function coreFetch(path: string, init?: RequestInit): Promise<Response> {
  for (const host of ordered()) {
    try {
      const res = await fetch(host + path, { ...init, signal: AbortSignal.timeout(9000) });
      cachedBase = host;
      return res;
    } catch {
      cachedBase = null;
    }
  }
  throw new Error("Marmo co-signer is unreachable");
}

export interface ServerShard {
  shardId: string;
  publicKey: string;
}

export async function createServerShard(): Promise<ServerShard> {
  const res = await coreFetch("/v1/shards", { method: "POST" });
  if (!res.ok) throw new Error("Could not create co-signer shard");
  return res.json();
}

export async function registerWallet(address: string, shardId: string): Promise<string> {
  const res = await coreFetch("/v1/wallets", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ address, shardId }),
  });
  if (!res.ok) throw new Error("Could not register wallet with co-signer");
  const data = (await res.json()) as { apiKey: string };
  return data.apiKey;
}

export async function cosign(
  address: string,
  apiKey: string,
  transactionBytes: string,
  amountSui: number,
): Promise<string> {
  const res = await coreFetch(`/v1/wallets/${address}/cosign`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ transactionBytes, amountSui }),
  });
  const data = (await res.json().catch(() => ({}))) as { signature?: string; error?: string };
  if (!res.ok || !data.signature) throw new Error(data.error ?? "Co-signer declined to sign");
  return data.signature;
}
