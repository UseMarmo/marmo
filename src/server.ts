import { Hono } from "hono";
import { cors } from "hono/cors";
import { createHash } from "node:crypto";
import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { Transaction } from "@mysten/sui/transactions";
import { fromBase64 } from "@mysten/sui/utils";
import { encryptSecret, decryptSecret, newApiKey, newId } from "./crypto.js";
import {
  initStore,
  pingStore,
  putShard,
  getShard,
  putWallet,
  getWallet,
  saveWallet,
  type WalletRecord,
} from "./store.js";

const VAULT_KEY = process.env.MARMO_VAULT_KEY ?? "dev-only-insecure-key";
const PORT = Number(process.env.PORT ?? 8080);

await initStore();

const app = new Hono();
app.use("/v1/*", cors());

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

app.get("/", (c) => c.json({ service: "marmo-core", status: "ok" }));

app.get("/health", async (c) => {
  const db = await pingStore();
  return c.json({ ok: db, service: "marmo-core", network: "testnet", db: db ? "up" : "down" }, db ? 200 : 503);
});

app.post("/v1/shards", async (c) => {
  const keypair = Ed25519Keypair.generate();
  const shardId = newId("shard");
  await putShard({
    shardId,
    publicKey: keypair.getPublicKey().toBase64(),
    encSecret: encryptSecret(keypair.getSecretKey(), VAULT_KEY),
  });
  return c.json({ shardId, publicKey: keypair.getPublicKey().toBase64() }, 201);
});

app.post("/v1/wallets", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.address || !body?.shardId) {
    return c.json({ error: "address and shardId are required" }, 400);
  }
  if (!(await getShard(body.shardId))) {
    return c.json({ error: "unknown shardId" }, 404);
  }
  if (await getWallet(body.address)) {
    return c.json({ error: "wallet already registered" }, 409);
  }

  const apiKey = newApiKey();
  await putWallet({
    address: body.address,
    shardId: body.shardId,
    apiKeyHash: hashKey(apiKey),
    members: Array.isArray(body.members) ? body.members : [],
    dailyLimitSui: Number(body.dailyLimitSui ?? 1000),
    spentTodaySui: 0,
    spentDate: today(),
    createdAt: new Date().toISOString(),
  });

  return c.json({ address: body.address, apiKey }, 201);
});

app.post("/v1/wallets/:address/cosign", async (c) => {
  const address = c.req.param("address");
  const wallet = await getWallet(address);
  if (!wallet) return c.json({ error: "wallet not found" }, 404);

  const auth = c.req.header("authorization") ?? "";
  const provided = auth.replace(/^Bearer\s+/i, "");
  if (!provided || hashKey(provided) !== wallet.apiKeyHash) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => null);
  if (!body?.transactionBytes) {
    return c.json({ error: "transactionBytes (base64) required" }, 400);
  }

  let bytes: Uint8Array;
  let sender: string | null | undefined;
  try {
    bytes = fromBase64(body.transactionBytes);
    sender = Transaction.from(bytes).getData().sender;
  } catch {
    return c.json({ error: "could not parse transaction" }, 400);
  }

  if (sender && sender !== address) {
    return c.json({ error: "transaction sender does not match this wallet" }, 403);
  }

  const amount = Number(body.amountSui ?? 0);
  const allowed = await enforceDailyLimit(wallet, amount);
  if (!allowed) return c.json({ error: "daily spending limit exceeded" }, 403);

  const record = await getShard(wallet.shardId);
  if (!record) return c.json({ error: "shard unavailable" }, 500);

  const keypair = Ed25519Keypair.fromSecretKey(decryptSecret(record.encSecret, VAULT_KEY));
  const { signature } = await keypair.signTransaction(bytes);

  return c.json({ signature, signer: record.publicKey });
});

async function enforceDailyLimit(wallet: WalletRecord, amountSui: number): Promise<boolean> {
  const now = today();
  const spent = wallet.spentDate === now ? wallet.spentTodaySui : 0;
  if (spent + amountSui > wallet.dailyLimitSui) return false;

  await saveWallet({ ...wallet, spentDate: now, spentTodaySui: spent + amountSui });
  return true;
}

Bun.serve({ port: PORT, fetch: app.fetch });
console.log(`marmo-core listening on :${PORT}`);
