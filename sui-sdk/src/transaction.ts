import { Transaction } from "@mysten/sui/transactions";
import { MIST_PER_SUI } from "@mysten/sui/utils";
import type { SuiClient, SuiTransactionBlockResponse } from "@mysten/sui/client";
import type { Shard } from "./shard.js";
import type { MarmoWallet } from "./wallet.js";

export async function buildTransaction(
  client: SuiClient,
  wallet: MarmoWallet,
  compose: (tx: Transaction) => void,
): Promise<Uint8Array> {
  const tx = new Transaction();
  tx.setSender(wallet.address);
  compose(tx);
  return tx.build({ client });
}

export async function buildTransferSui(
  client: SuiClient,
  wallet: MarmoWallet,
  recipient: string,
  amountSui: number,
): Promise<Uint8Array> {
  const amount = BigInt(Math.round(amountSui * Number(MIST_PER_SUI)));
  return buildTransaction(client, wallet, (tx) => {
    const [coin] = tx.splitCoins(tx.gas, [amount]);
    tx.transferObjects([coin], recipient);
  });
}

export async function signAndSubmit(
  client: SuiClient,
  wallet: MarmoWallet,
  transactionBytes: Uint8Array,
  shards: Shard[],
): Promise<SuiTransactionBlockResponse> {
  const signatures = await Promise.all(shards.map((shard) => shard.sign(transactionBytes)));
  return submit(client, wallet, transactionBytes, signatures);
}

export async function submit(
  client: SuiClient,
  wallet: MarmoWallet,
  transactionBytes: Uint8Array,
  partialSignatures: string[],
): Promise<SuiTransactionBlockResponse> {
  const signature = wallet.combine(partialSignatures);
  const result = await client.executeTransactionBlock({
    transactionBlock: transactionBytes,
    signature,
    options: { showEffects: true, showBalanceChanges: true },
  });
  await client.waitForTransaction({ digest: result.digest });
  return result;
}
