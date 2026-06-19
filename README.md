<p align="center">
  <img src="docs/logo-circle.png" width="100" height="100" alt="Marmo" />
</p>

<h1 align="center">Marmo</h1>

<p align="center">
  <strong>Private 2-of-3 threshold wallet on Base</strong>
</p>

<p align="center">
  <a href="https://usemarmo.xyz">usemarmo.xyz</a> &nbsp;|&nbsp;
  <a href="https://usemarmo.xyz/whitepaper">Whitepaper</a> &nbsp;|&nbsp;
  <a href="https://usemarmo.xyz/roadmap">Roadmap</a>
</p>

<p align="center">
  <a href="https://github.com/UseMarmo/marmo/actions/workflows/core.yml"><img src="https://github.com/UseMarmo/marmo/actions/workflows/core.yml/badge.svg" alt="Core CI" /></a>
  <a href="https://github.com/UseMarmo/marmo/actions/workflows/desktop.yml"><img src="https://github.com/UseMarmo/marmo/actions/workflows/desktop.yml/badge.svg" alt="Desktop CI" /></a>
  <a href="https://github.com/UseMarmo/marmo/actions/workflows/sdk.yml"><img src="https://github.com/UseMarmo/marmo/actions/workflows/sdk.yml/badge.svg" alt="SDK CI" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="MIT" /></a>
  <a href="https://www.npmjs.com/package/@usemarmo/base-sdk"><img src="https://img.shields.io/npm/v/@usemarmo/base-sdk?label=%40usemarmo%2Fbase-sdk" alt="npm" /></a>
</p>

---

One wallet, split in three. Your device holds one shard. Marmo holds one. Your recovery key holds one. Any two can spend. No single one ever can.

---

## Security model

Marmo creates three secp256k1 key shards at wallet setup:

| Shard | Holder | Technology |
|---|---|---|
| A | Your device / USB drive | secp256k1 key, stored locally |
| B | Marmo co-signer | secp256k1 key, AES-256-GCM encrypted at rest |
| C | Recovery | secp256k1 key, backed up encrypted to co-signer, retrieved via TOTP (Passkey / WebAuthn coming soon) |

The wallet is an ERC-4337 smart account on Base. Spending requires any two shards to produce a 130-byte combined ECDSA payload (`sigA || sigB`, 65 bytes each). The `MarmoAccount` contract validates this in `validateUserOp`. No single shard can produce a valid payload alone.

### The math

Let `p` be the probability of an attacker independently compromising any one shard. For a single-key wallet, the probability of theft is `p`. For a 2-of-3 scheme:

```
P(theft) = C(3,2) * p^2 * (1-p) + p^3
         = 3p^2 - 2p^3
```

At `p = 0.01` (1% per-shard attack probability), a single-key wallet has a 1% theft probability. Marmo reduces this to **0.03%**, roughly 33x harder to steal. The improvement grows as `p` shrinks: at `p = 0.001`, the ratio is 3000x.

The three shards live in orthogonal security domains: local hardware, a remote server, and an encrypted recovery backup gated by TOTP. An attacker must simultaneously breach two independent systems.

---

## How Marmo compares

| | Marmo | Ledger | Gnosis Safe | Privy | MetaMask |
|---|---|---|---|---|---|
| Key model | 2-of-3 threshold | Single hardware key | N-of-M on-chain | MPC with Privy | Single hot key |
| Single point of failure | None | Seed phrase | Single owner | Privy infrastructure | Password / seed |
| Custody | Fully self-custodial | Self-custodial | Self-custodial | Shared with Privy | Self-custodial |
| Stealth / privacy | Yes (Base stealth) | No | No | No | No |
| Gas model | Single ERC-4337 UserOp | Standard EOA tx | One tx per signature | Varies | Standard EOA tx |
| On-chain signing overhead | Off-chain signature combine | None | On-chain quorum | Off-chain MPC | None |

**vs Ledger:** Hardware is excellent for storing Shard A, but a hardware wallet is ultimately protected by a single seed phrase. Lose that phrase and all funds are gone. Marmo has no single backup string that unlocks the entire wallet.

**vs Gnosis Safe:** Gnosis is true multisig but each owner signature is an on-chain transaction, adding L1/L2 overhead and no privacy. Marmo combines signatures off-chain into one 130-byte payload submitted as a standard UserOp.

**vs Privy:** Privy uses MPC where their servers hold key shares. Even in their "self-custody" mode, Privy's infrastructure must participate in every transaction. With Marmo, Shard B (the co-signer) can refuse a transaction but cannot initiate one without your device key.

**vs MetaMask:** MetaMask stores a single secp256k1 key protected by a local password. One compromised password, browser extension, or phishing attack is enough to drain the wallet. With Marmo, compromising any single shard leaves the attacker one signature short.

---

## For developers

### `@usemarmo/base-sdk`

The SDK gives you the 2-of-3 sharding primitives to build Marmo-style wallets in any TypeScript project.

```bash
npm install @usemarmo/base-sdk
# or
bun add @usemarmo/base-sdk
```

**Generate shards and predict the smart account address:**

```ts
import { generateShard, predictAddress } from "@usemarmo/base-sdk";

const shardA = generateShard();
const shardC = generateShard();

// register shardA + shardC with your co-signer to get shardB
const accountAddress = await predictAddress(
  [shardA.address, shardBAddress, shardC.address],
  { factory: "0xYourFactoryAddress" }
);
```

**Sign a UserOperation and send it:**

```ts
import { signUserOp, combineSignatures } from "@usemarmo/base-sdk";

const sigA = await signUserOp(shardA.privateKey, userOpHash);
const sigB = await cosigner.sign(userOpHash);

const signature = combineSignatures(sigA, sigB);
// pass `signature` in your PackedUserOperation
```

Full API reference and wallet creation walkthrough: [base-sdk/README.md](base-sdk/README.md)

Co-signer API: `https://api.usemarmo.xyz`

---

## Download the desktop wallet

**[Download from GitHub Releases](https://github.com/UseMarmo/marmo/releases/latest)**

| Platform | Installer |
|---|---|
| macOS Apple Silicon | `.dmg` ending in `_aarch64.dmg` |
| macOS Intel | `.dmg` ending in `_x64.dmg` |
| Windows | `-setup.exe` |
| Ubuntu / Debian | `.deb` |
| Arch Linux | See [packaging/arch/PKGBUILD](packaging/arch/PKGBUILD) |

**Arch Linux (PKGBUILD):**

```bash
git clone https://github.com/UseMarmo/marmo
cd marmo/packaging/arch
makepkg -si
```

This builds against your system webkit so the app renders correctly on modern Mesa/Wayland.

---

## Whitepaper

[Read the full paper](https://usemarmo.xyz/whitepaper)

---

## Roadmap

[See what is coming next](https://usemarmo.xyz/roadmap)

---

## Repo layout

```
marmo/
  src/              co-signer server (Hono, Bun, Postgres)
  db/migrations/    Postgres schema migrations
  contract/         ERC-4337 smart contracts (Hardhat, Solidity 0.8.28)
  desktop/          Desktop wallet (Tauri v2, Vite, TypeScript)
  base-sdk/         @usemarmo/base-sdk
  packaging/        Platform-specific packaging (Flatpak, Arch PKGBUILD)
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup.

---

## License

[MIT](LICENSE)
