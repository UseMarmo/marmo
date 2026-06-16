import { Shard, MarmoWallet, createClient, buildTransferSui, signAndSubmit } from "../src/index.js";
import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";

const client = createClient("testnet");

const drive = Shard.create("drive");
const server = Shard.create("server");
const recovery = Shard.create("recovery");

const wallet = MarmoWallet.twoOfThree(drive, server, recovery);
console.log("Wallet:", wallet.address);

await requestSuiFromFaucetV2({ host: getFaucetHost("testnet"), recipient: wallet.address });
for (let i = 0; i < 15; i++) {
  await new Promise((r) => setTimeout(r, 2000));
  const { totalBalance } = await client.getBalance({ owner: wallet.address });
  if (BigInt(totalBalance) > 0n) break;
}

const recipient = Shard.create().address;
const txBytes = await buildTransferSui(client, wallet, recipient, 0.01);
const result = await signAndSubmit(client, wallet, txBytes, [drive, server]);

console.log("Status:", result.effects?.status.status);
console.log("Explorer: https://suiscan.xyz/testnet/tx/" + result.digest);
