<div align="center">
  <img src="./logo.jpg" width="96" height="96" alt="Marmo" />
  <h1>@marmoxyz/sui-kit</h1>
  <p><strong>Turn any storage drive into a hardware wallet shard.</strong></p>
  <p>An open-source threshold sharding kit for Sui. Split a wallet into shards and spend with any 2 of 3, with no single point of failure and no proprietary hardware.</p>
</div>

---

## Why

Storing crypto today means choosing between a hot wallet that keeps your whole key in one place, or a $150 proprietary hardware wallet. Marmo takes a third path: it splits your wallet into independent shards using Sui native multisig, so no single device, server, or login ever holds the power to move your funds.

- **Drive shard** lives as an encrypted file on any cheap USB or hard drive you already own.
- **Server shard** lives with a non-custodial co-signer that can never spend on its own.
- **Recovery shard** lives behind a Google login via zkLogin.

Lose any one shard and the other two still work. Steal any one shard and it is useless on its own. The full private key never exists in one place.

## Install

```bash
npm install @marmoxyz/sui-kit @mysten/sui
```

## Quick start

```ts
import {
  Shard,
  MarmoWallet,
  createClient,
  buildTransferSui,
  signAndSubmit,
} from "@marmoxyz/sui-kit";

const drive = Shard.create("drive");
const server = Shard.create("server");
const recovery = Shard.create("recovery");

const wallet = MarmoWallet.twoOfThree(drive, server, recovery);
console.log(wallet.address);

const client = createClient("testnet");
const tx = await buildTransferSui(client, wallet, "0xRECIPIENT", 0.01);

const result = await signAndSubmit(client, wallet, tx, [drive, server]);
console.log(result.effects?.status.status);
```

The same wallet can be spent by any 2 of the 3 shards. If the drive is lost, sign with `[server, recovery]` instead.

## Concepts

### Shard

A `Shard` wraps a single Ed25519 keypair. Create one, import one from a saved secret, sign with it, or export its secret for cold storage.

```ts
const shard = Shard.create("drive");
const address = shard.address;
const secret = shard.exportSecret();

const restored = Shard.fromSecret(secret, "drive");
```

### MarmoWallet

A `MarmoWallet` combines several shard public keys into one on-chain address governed by a threshold. The shards never have to be in the same place to create the wallet, only their public keys.

```ts
const wallet = MarmoWallet.from({
  members: [drive, server, recovery],
  threshold: 2,
});

const sameAsTwoOfThree = MarmoWallet.twoOfThree(drive, server, recovery);
```

Weighted members are supported for advanced policies:

```ts
const wallet = MarmoWallet.from({
  members: [
    { publicKey: drive.publicKey, weight: 2 },
    { publicKey: server.publicKey, weight: 1 },
    { publicKey: recovery.publicKey, weight: 1 },
  ],
  threshold: 3,
});
```

### Signing

Shards sign the same transaction bytes independently, then their partial signatures are combined. Signing can happen on different machines: build the bytes once, distribute them, collect signatures back, and submit.

```ts
const tx = await buildTransaction(client, wallet, (t) => {
  const [coin] = t.splitCoins(t.gas, [1_000_000n]);
  t.transferObjects([coin], "0xRECIPIENT");
});

const driveSig = await drive.sign(tx);
const serverSig = await server.sign(tx);

await submit(client, wallet, tx, [driveSig, serverSig]);
```

## API

| Export | Description |
| --- | --- |
| `Shard.create(label?)` | Generate a new shard. |
| `Shard.fromSecret(secret, label?)` | Restore a shard from an exported secret. |
| `shard.publicKey` / `shard.address` | The shard public key and its standalone address. |
| `shard.exportSecret()` | Serialize the secret for encrypted storage. |
| `shard.sign(bytes)` | Produce a partial signature over transaction bytes. |
| `MarmoWallet.from({ members, threshold })` | Build a wallet from members and a threshold. |
| `MarmoWallet.twoOfThree(a, b, c)` | Convenience for the classic 2 of 3 split. |
| `wallet.address` | The multisig wallet address that holds funds. |
| `wallet.combine(signatures)` | Combine partial signatures into a submittable signature. |
| `createClient(network?)` | A Sui client for `testnet`, `mainnet`, `devnet`, or `localnet`. |
| `buildTransaction(client, wallet, compose)` | Build transaction bytes with the wallet as sender. |
| `buildTransferSui(client, wallet, to, amountSui)` | Build a SUI transfer. |
| `signAndSubmit(client, wallet, bytes, shards)` | Sign with the given shards and submit. |
| `submit(client, wallet, bytes, signatures)` | Combine existing partial signatures and submit. |

## Security model

Marmo relies on Sui native multisig, a protocol-level primitive, rather than hand-rolled cryptography. The threshold is enforced by the Sui network itself: a transaction carrying fewer than the required signatures is rejected by validators, not by client code.

What this gives you:

- No single point of failure. One shard can never move funds.
- Recoverability. Any quorum of shards can sign, so losing one shard is survivable.
- Self-custody. The co-signer holds only one shard and cannot spend alone.

What to keep in mind:

- Each shard is a real key. Store the drive shard encrypted and treat the recovery path as seriously as the primary path.
- Signing assembles partial signatures, not the key. To resist host malware, the quorum should sign across separate environments, for example device plus server, rather than two shards on the same compromised machine.

## License

MIT
