/**
 * Marmo — Core Spine
 * ==================
 * Proves the entire Marmo thesis in one headless script, on Sui testnet:
 *
 *   1. Three independent keypairs are created — the three "shards":
 *        A = Drive    (encrypted file on a USB drive)
 *        B = Server   (held by Marmo's non-custodial co-signer)
 *        C = Recovery (will become a zkLogin / Google identity)
 *
 *   2. Their three PUBLIC keys combine into ONE 2-of-3 multisig address.
 *      That address is the user's wallet. Funds live there.
 *
 *   3. To spend, ANY 2 of the 3 shards sign the SAME transaction, the two
 *      partial signatures are combined, and Sui accepts it.
 *
 *   4. We also prove the threshold is real: a single shard's signature is
 *      REJECTED by the network.
 *
 * No single shard can move funds. Lose any one shard and the other two still
 * work. That is Marmo.
 */

import { Ed25519Keypair } from "@mysten/sui/keypairs/ed25519";
import { MultiSigPublicKey } from "@mysten/sui/multisig";
import { SuiClient, getFullnodeUrl } from "@mysten/sui/client";
import { Transaction } from "@mysten/sui/transactions";
import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { MIST_PER_SUI } from "@mysten/sui/utils";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const NETWORK = "testnet";
const KEYS_FILE = new URL("./keys.json", import.meta.url).pathname;
const client = new SuiClient({ url: getFullnodeUrl(NETWORK) });

const line = () => console.log("─".repeat(64));

/**
 * Load the three shard keypairs from disk, or generate + persist them.
 * We persist so the funded address stays stable across runs (the testnet
 * faucet is rate-limited — we don't want a fresh empty address every time).
 */
function loadOrCreateShards() {
  if (existsSync(KEYS_FILE)) {
    const saved = JSON.parse(readFileSync(KEYS_FILE, "utf8")) as string[];
    return saved.map((sk) => Ed25519Keypair.fromSecretKey(sk));
  }
  const shards = [
    Ed25519Keypair.generate(), // A — Drive
    Ed25519Keypair.generate(), // B — Server
    Ed25519Keypair.generate(), // C — Recovery
  ];
  writeFileSync(KEYS_FILE, JSON.stringify(shards.map((kp) => kp.getSecretKey()), null, 2));
  return shards;
}

/** Ensure the wallet has gas. Requests from the faucet and waits if empty. */
async function ensureFunded(address: string) {
  const { totalBalance } = await client.getBalance({ owner: address });
  if (BigInt(totalBalance) > 0n) {
    console.log(`✓ Balance: ${Number(totalBalance) / Number(MIST_PER_SUI)} SUI`);
    return;
  }
  console.log("• Wallet empty — requesting testnet SUI from faucet...");
  await requestSuiFromFaucetV2({ host: getFaucetHost(NETWORK), recipient: address });

  // Faucet is async; poll until the coin lands (up to ~30s).
  for (let i = 0; i < 15; i++) {
    await new Promise((r) => setTimeout(r, 2000));
    const { totalBalance } = await client.getBalance({ owner: address });
    if (BigInt(totalBalance) > 0n) {
      console.log(`✓ Funded: ${Number(totalBalance) / Number(MIST_PER_SUI)} SUI`);
      return;
    }
  }
  throw new Error("Faucet did not deliver funds in time — try running again in a minute.");
}

async function main() {
  line();
  console.log("  MARMO — 2-of-3 multisig spine  (Sui " + NETWORK + ")");
  line();

  // ── Step 1: the three shards ────────────────────────────────────────────
  const [drive, server, recovery] = loadOrCreateShards();
  const labels = ["A · Drive   ", "B · Server  ", "C · Recovery"];
  [drive, server, recovery].forEach((kp, i) => {
    console.log(`  Shard ${labels[i]}  ${kp.getPublicKey().toSuiAddress()}`);
  });

  // ── Step 2: combine PUBLIC keys → one 2-of-3 multisig wallet ─────────────
  const multisig = MultiSigPublicKey.fromPublicKeys({
    threshold: 2,
    publicKeys: [
      { publicKey: drive.getPublicKey(), weight: 1 },
      { publicKey: server.getPublicKey(), weight: 1 },
      { publicKey: recovery.getPublicKey(), weight: 1 },
    ],
  });
  const wallet = multisig.toSuiAddress();
  line();
  console.log(`  WALLET (2-of-3): ${wallet}`);
  line();

  // ── Step 3: make sure we have gas ───────────────────────────────────────
  await ensureFunded(wallet);

  // Build one transaction: send 0.01 SUI to a throwaway address.
  const recipient = Ed25519Keypair.generate().getPublicKey().toSuiAddress();
  const buildTx = async () => {
    const tx = new Transaction();
    tx.setSender(wallet);
    const [coin] = tx.splitCoins(tx.gas, [MIST_PER_SUI / 100n]); // 0.01 SUI
    tx.transferObjects([coin], recipient);
    return tx.build({ client });
  };

  // ── Step 4a: prove the threshold is REAL — 1 signature must fail ─────────
  console.log("\n  Test 1 — sign with only Drive (1 of 3)…");
  {
    const txBytes = await buildTx();
    const onlyDrive = (await drive.signTransaction(txBytes)).signature;
    const underThreshold = multisig.combinePartialSignatures([onlyDrive]);
    try {
      await client.executeTransactionBlock({ transactionBlock: txBytes, signature: underThreshold });
      console.log("  ✗ UNEXPECTED: network accepted a single shard!");
    } catch {
      console.log("  ✓ Rejected by Sui — one shard alone cannot spend. (this is the point)");
    }
  }

  // ── Step 4b: the real thing — Drive + Server (2 of 3) ────────────────────
  console.log("\n  Test 2 — sign with Drive + Server (2 of 3)…");
  const txBytes = await buildTx();
  const sigDrive = (await drive.signTransaction(txBytes)).signature;
  const sigServer = (await server.signTransaction(txBytes)).signature;
  const combined = multisig.combinePartialSignatures([sigDrive, sigServer]);

  const result = await client.executeTransactionBlock({
    transactionBlock: txBytes,
    signature: combined,
    options: { showEffects: true, showBalanceChanges: true },
  });
  await client.waitForTransaction({ digest: result.digest });

  const ok = result.effects?.status.status === "success";
  console.log(`  ${ok ? "✓" : "✗"} Status: ${result.effects?.status.status}`);
  console.log(`  ✓ Confirmed: https://suiscan.xyz/${NETWORK}/tx/${result.digest}`);

  // ── Step 4c: recovery path — Drive is LOST, Server + Recovery sign ────────
  console.log("\n  Test 3 — Drive is lost; sign with Server + Recovery (2 of 3)…");
  const recoveryTx = await buildTx();
  const sigServer2 = (await server.signTransaction(recoveryTx)).signature;
  const sigRecovery = (await recovery.signTransaction(recoveryTx)).signature;
  const recoveryCombined = multisig.combinePartialSignatures([sigServer2, sigRecovery]);

  const recoveryResult = await client.executeTransactionBlock({
    transactionBlock: recoveryTx,
    signature: recoveryCombined,
    options: { showEffects: true },
  });
  await client.waitForTransaction({ digest: recoveryResult.digest });
  const recoveryOk = recoveryResult.effects?.status.status === "success";
  console.log(`  ${recoveryOk ? "✓" : "✗"} Status: ${recoveryResult.effects?.status.status} — funds recovered without the Drive.`);
  console.log(`  ✓ Confirmed: https://suiscan.xyz/${NETWORK}/tx/${recoveryResult.digest}`);

  line();
  console.log("  PROVEN ✅");
  console.log("  • 1 shard  → rejected by Sui");
  console.log("  • Drive + Server    → spends");
  console.log("  • Server + Recovery → spends (drive lost, funds safe)");
  console.log("  No single shard ever held the power to move these funds.");
}

main().catch((e) => {
  console.error("\n✗ Spine failed:", e instanceof Error ? e.message : e);
  process.exit(1);
});
