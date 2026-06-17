import { Hono } from "hono";
import { cors } from "hono/cors";
import { createHash } from "node:crypto";
import { generatePrivateKey, privateKeyToAddress, privateKeyToAccount } from "viem/accounts";
import { hexToBytes } from "viem";
import { encryptSecret, decryptSecret, newApiKey, newId } from "./crypto.js";
import { migrate } from "./db/migrate.js";
import { pingStore, putShard, getShard, putWallet, getWallet, type WalletRecord } from "./store.js";
import { computeStealthAddress, parseMetaAddress } from "./stealth.js";
import { getAnnouncements, getLatestBlock, NETWORK } from "./chain.js";
import { quoteExactIn, buildSwapCalldata, listTokens } from "./swap.js";

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
  c.json({ service: "marmo-core", version: "0.4.0", network: NETWORK })
);

app.get("/health", async (c) => {
  const db = await pingStore();
  return c.json(
    { ok: db, service: "marmo-core", network: NETWORK, db: db ? "up" : "down" },
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

app.get("/v1/quote", async (c) => {
  const tokenIn = c.req.query("tokenIn");
  const tokenOut = c.req.query("tokenOut");
  const amountInRaw = c.req.query("amountIn");
  const feeRaw = c.req.query("fee");

  if (!tokenIn || !tokenOut || !amountInRaw) {
    return c.json({ error: "tokenIn, tokenOut, amountIn are required" }, 400);
  }

  let amountIn: bigint;
  try {
    amountIn = BigInt(amountInRaw);
  } catch {
    return c.json({ error: "amountIn must be an integer (wei / smallest unit)" }, 400);
  }

  try {
    const { amountOut, fee } = await quoteExactIn({
      tokenIn,
      tokenOut,
      amountIn,
      fee: feeRaw ? Number(feeRaw) : undefined,
    });
    return c.json({ tokenIn, tokenOut, amountIn: amountIn.toString(), amountOut: amountOut.toString(), fee });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

app.get("/v1/tokens", (c) => c.json(listTokens()));

app.post("/v1/wallets/:address/tx/swap", async (c) => {
  const address = c.req.param("address").toLowerCase();
  const wallet = await getWallet(address);
  if (!wallet) return c.json({ error: "wallet not found" }, 404);

  const auth = c.req.header("authorization") ?? "";
  const provided = auth.replace(/^Bearer\s+/i, "");
  if (!provided || hashKey(provided) !== wallet.apiKeyHash) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => null);
  if (!body?.tokenIn || !body?.tokenOut || !body?.amountIn) {
    return c.json({ error: "tokenIn, tokenOut, amountIn are required" }, 400);
  }

  let amountIn: bigint;
  try {
    amountIn = BigInt(body.amountIn);
  } catch {
    return c.json({ error: "amountIn must be an integer string (wei / smallest unit)" }, 400);
  }

  const slippageBps = Number(body.slippageBps ?? 50);

  try {
    const { amountOut, fee } = await quoteExactIn({
      tokenIn: body.tokenIn as string,
      tokenOut: body.tokenOut as string,
      amountIn,
      fee: body.fee ? Number(body.fee) : undefined,
    });

    const amountOutMinimum = (amountOut * BigInt(10_000 - slippageBps)) / 10_000n;

    const { callData, value } = buildSwapCalldata({
      tokenIn: body.tokenIn as string,
      tokenOut: body.tokenOut as string,
      amountIn,
      amountOutMinimum,
      fee,
      recipient: address as `0x${string}`,
    });

    return c.json({
      callData,
      value: value.toString(),
      amountIn: amountIn.toString(),
      amountOut: amountOut.toString(),
      amountOutMinimum: amountOutMinimum.toString(),
      fee,
      slippageBps,
    });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

app.post("/v1/stealth/compute", async (c) => {
  const body = await c.req.json().catch(() => null);
  if (!body?.metaAddress) {
    return c.json({ error: "metaAddress required" }, 400);
  }
  try {
    const meta = parseMetaAddress(body.metaAddress as string);
    const result = computeStealthAddress(meta);
    return c.json(result);
  } catch (e) {
    return c.json({ error: (e as Error).message }, 400);
  }
});

app.get("/v1/wallets/:address/stealth/announcements", async (c) => {
  const address = c.req.param("address").toLowerCase();
  const wallet = await getWallet(address);
  if (!wallet) return c.json({ error: "wallet not found" }, 404);

  const auth = c.req.header("authorization") ?? "";
  const provided = auth.replace(/^Bearer\s+/i, "");
  if (!provided || hashKey(provided) !== wallet.apiKeyHash) {
    return c.json({ error: "unauthorized" }, 401);
  }

  const fromBlockRaw = c.req.query("fromBlock");
  const toBlockRaw = c.req.query("toBlock");

  let fromBlock: bigint;
  let toBlock: bigint;

  try {
    if (toBlockRaw) {
      toBlock = BigInt(toBlockRaw);
    } else {
      toBlock = await getLatestBlock();
    }
    fromBlock = fromBlockRaw ? BigInt(fromBlockRaw) : toBlock - 5_000n;
  } catch {
    return c.json({ error: "fromBlock and toBlock must be integers" }, 400);
  }

  try {
    const announcements = await getAnnouncements(fromBlock, toBlock);
    return c.json({ fromBlock: fromBlock.toString(), toBlock: toBlock.toString(), announcements });
  } catch (e) {
    return c.json({ error: (e as Error).message }, 500);
  }
});

async function enforceDailyLimit(wallet: WalletRecord, amountUsd: number): Promise<boolean> {
  const now = today();
  const spent = wallet.spentDate === now ? wallet.spentTodayUsd : 0;
  if (spent + amountUsd > wallet.dailyLimitUsd) return false;
  await putWallet({ ...wallet, spentDate: now, spentTodayUsd: spent + amountUsd });
  return true;
}

Bun.serve({ port: PORT, fetch: app.fetch });
console.log(`marmo-core v0.4.0 listening on :${PORT} (${NETWORK})`);
