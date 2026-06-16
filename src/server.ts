import { Hono } from "hono";
import { cors } from "hono/cors";
import { createHash } from "node:crypto";
import { generatePrivateKey, privateKeyToAddress, privateKeyToAccount } from "viem/accounts";
import { hexToBytes } from "viem";
import { encryptSecret, decryptSecret, newApiKey, newId } from "./crypto.js";
import { migrate } from "./db/migrate.js";
import { pingStore, putShard, getShard, putWallet, getWallet, type WalletRecord } from "./store.js";

const VAULT_KEY = process.env.MARMO_VAULT_KEY ?? "dev-only-insecure-key";
const PORT = Number(process.env.PORT ?? 8080);

await migrate();

const app = new Hono();
app.use("/v1/*", cors());

function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

function today(): string {
  return new Date().toISOString().slice(0, 10);
}

app.get("/", (c) =>
  c.json({ service: "marmo-core", version: "0.2.0", chain: "base" })
);

app.get("/health", async (c) => {
  const db = await pingStore();
  return c.json(
    { ok: db, service: "marmo-core", chain: "base", db: db ? "up" : "down" },
    db ? 200 : 503
  );
});

app.post("/v1/wallets", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.address || !body?.shardAAddress || !body?.shardCAddress) {
    return c.json({ error: "address, shardAAddress, shardCAddress are required" }, 400);
  }

  const walletAddress = (body.address as string).toLowerCase();

  if (await getWallet(walletAddress)) {
    return c.json({ error: "wallet already registered" }, 409);
  }

  const privateKey = generatePrivateKey();
  const shardBAddress = privateKeyToAddress(privateKey);
  const shardId = newId("shard");
  const apiKey = newApiKey();

  await putShard({
    shardId,
    address: shardBAddress,
    encPrivateKey: encryptSecret(privateKey, VAULT_KEY),
  });

  await putWallet({
    address: walletAddress,
    shardId,
    apiKeyHash: hashKey(apiKey),
    shardAAddress: (body.shardAAddress as string).toLowerCase(),
    shardCAddress: (body.shardCAddress as string).toLowerCase(),
    dailyLimitUsd: Number(body.dailyLimitUsd ?? 1000),
    spentTodayUsd: 0,
    spentDate: today(),
    createdAt: new Date().toISOString(),
  });

  return c.json({ address: walletAddress, shardBAddress, apiKey }, 201);
});

app.get("/v1/wallets/:address", async (c) => {
  const address = c.req.param("address").toLowerCase();
  const wallet = await getWallet(address);
  if (!wallet) return c.json({ error: "wallet not found" }, 404);

  const shard = await getShard(wallet.shardId);
  return c.json({
    address: wallet.address,
    shardBAddress: shard?.address,
    shardAAddress: wallet.shardAAddress,
    shardCAddress: wallet.shardCAddress,
    dailyLimitUsd: wallet.dailyLimitUsd,
  });
});

app.post("/v1/wallets/:address/cosign", async (c) => {
  const address = c.req.param("address").toLowerCase();
  const wallet = await getWallet(address);
  if (!wallet) return c.json({ error: "wallet not found" }, 404);

  const auth = c.req.header("authorization") ?? "";
  const provided = auth.replace(/^Bearer\s+/i, "");
  if (!provided || hashKey(provided) !== wallet.apiKeyHash) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => null);
  if (!body?.userOpHash || !/^0x[0-9a-fA-F]{64}$/.test(body.userOpHash)) {
    return c.json({ error: "userOpHash (0x-prefixed 32-byte hex) required" }, 400);
  }

  const amountUsd = Number(body.amountUsd ?? 0);
  if (!(await enforceDailyLimit(wallet, amountUsd))) {
    return c.json({ error: "daily spending limit exceeded" }, 403);
  }

  const record = await getShard(wallet.shardId);
  if (!record) return c.json({ error: "shard unavailable" }, 500);

  const privateKey = decryptSecret(record.encPrivateKey, VAULT_KEY) as `0x${string}`;
  const account = privateKeyToAccount(privateKey);

  const signature = await account.signMessage({
    message: { raw: hexToBytes(body.userOpHash) },
  });

  return c.json({ signature, signerAddress: account.address });
});

async function enforceDailyLimit(wallet: WalletRecord, amountUsd: number): Promise<boolean> {
  const now = today();
  const spent = wallet.spentDate === now ? wallet.spentTodayUsd : 0;
  if (spent + amountUsd > wallet.dailyLimitUsd) return false;
  await putWallet({ ...wallet, spentDate: now, spentTodayUsd: spent + amountUsd });
  return true;
}

Bun.serve({ port: PORT, fetch: app.fetch });
console.log(`marmo-core v0.2.0 listening on :${PORT} (Base)`);
