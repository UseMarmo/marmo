# @usemarmo/base-sdk

2-of-3 threshold sharding primitives for building Marmo-style smart account wallets on Base.

## What this is

This package gives you the cryptographic building blocks to implement the Marmo sharding pattern: three secp256k1 key shards (A, B, C) where any two can authorize a transaction. No single shard can spend alone.

Typical shard assignment:

| Shard | Holder | Role |
|-------|--------|------|
| A | User device | Signs by default |
| B | Co-signer service | Cosigns and enforces policy |
| C | Recovery (passkey, hardware key) | Used if A is lost |

Normal signing uses A + B. Recovery uses C + B.

This SDK handles the local shard side. The co-signer service (Shard B) is provided by the Marmo Core API, or you can implement your own.

## Install

```bash
npm install @usemarmo/base-sdk
# or
bun add @usemarmo/base-sdk
```

## Usage

### Generate a shard

```ts
import { generateShard } from "@usemarmo/base-sdk";

const shardA = generateShard();
// { address: "0x...", privateKey: "0x..." }
```

Each shard is a standard secp256k1 keypair. The `address` is used to register the shard with your smart account factory. The `privateKey` signs UserOperation hashes.

### Save and load a shard

```ts
import { exportShard, importShard } from "@usemarmo/base-sdk";

const json = exportShard(shardA);
// write to disk, OS keychain, hardware key, etc.

const loaded = importShard(json);
```

`exportShard` returns a JSON string. Store it somewhere appropriate for the shard's role: local app storage for Shard A, an encrypted backup drive for Shard C.

### Sign a UserOperation hash

```ts
import { signUserOp } from "@usemarmo/base-sdk";

const signature = await signUserOp(shardA.privateKey, userOpHash);
// 65-byte EIP-191 signature, 0x-prefixed hex
```

`userOpHash` is the 32-byte hash returned by `EntryPoint.getUserOpHash()` for your assembled `PackedUserOperation`.

### Combine two signatures

```ts
import { combineSignatures } from "@usemarmo/base-sdk";

const sigA = await signUserOp(shardA.privateKey, userOpHash);
const sigB = await cosignerService.sign(userOpHash); // your co-signer

const combined = combineSignatures(sigA, sigB);
// 130-byte hex: sigA (65 bytes) || sigB (65 bytes)
// pass this as `signature` in your PackedUserOperation
```

The Marmo `MarmoAccount` contract validates this combined signature in `validateUserOp`.

### Predict the smart account address

```ts
import { predictAddress } from "@usemarmo/base-sdk";

const address = await predictAddress(
  [shardA.address, shardB.address, shardC.address],
  { factory: "0xYourMarmoAccountFactoryAddress" }
);
```

This calls `MarmoAccountFactory.predictAddress` on Base mainnet. You can override the RPC with `options.rpcUrl` and the CREATE2 salt with `options.salt`.

## Full wallet creation example

```ts
import { generateShard, exportShard, signUserOp, combineSignatures } from "@usemarmo/base-sdk";

// 1. Generate local shards
const shardA = generateShard();
const shardC = generateShard();

// 2. Register with your co-signer to get Shard B address
const { shardBAddress, apiKey } = await fetch("https://your-cosigner/v1/wallets", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    address: shardA.address,
    shardAAddress: shardA.address,
    shardCAddress: shardC.address,
  }),
}).then((r) => r.json());

// 3. Predict the smart account address
const accountAddress = await predictAddress(
  [shardA.address, shardBAddress, shardC.address],
  { factory: "0xYourFactoryAddress" }
);

// 4. Save shards appropriately
const shardABackup = exportShard(shardA);   // save to device storage
const shardCBackup = exportShard(shardC);   // save behind passkey / recovery

// 5. Sign a UserOp later
const sigA = await signUserOp(shardA.privateKey, userOpHash);
const sigB = await fetch(`https://your-cosigner/v1/wallets/${accountAddress}/cosign`, {
  method: "POST",
  headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
  body: JSON.stringify({ userOpHash }),
}).then((r) => r.json()).then((d) => d.signature);

const signature = combineSignatures(sigA, sigB);
```

## API

### `generateShard(): Shard`

Generates a random secp256k1 keypair.

### `exportShard(shard: Shard): string`

Serializes a shard to a JSON string for storage.

### `importShard(json: string): Shard`

Deserializes a shard from a JSON string. Throws if fields are missing.

### `signUserOp(privateKey, userOpHash): Promise<string>`

Signs a 32-byte EIP-4337 UserOperation hash using EIP-191 message signing. Returns a 65-byte hex signature.

### `combineSignatures(sigA, sigB): string`

Concatenates two 65-byte signatures into the 130-byte format expected by `MarmoAccount.validateUserOp`. Throws if either signature is not 65 bytes.

### `predictAddress(owners, options): Promise<string>`

Calls `MarmoAccountFactory.predictAddress` on-chain. `owners` is a 3-element array of shard addresses. `options.factory` is required; `options.salt` (default `0n`) and `options.rpcUrl` are optional.

## License

MIT
