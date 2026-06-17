<p align="center">
  <img src="docs/logo-circle.png" width="100" height="100" alt="Marmo" />
</p>

# Marmo

[![Core CI](https://github.com/UseMarmo/marmo/actions/workflows/core.yml/badge.svg)](https://github.com/UseMarmo/marmo/actions/workflows/core.yml)
[![Desktop CI](https://github.com/UseMarmo/marmo/actions/workflows/desktop.yml/badge.svg)](https://github.com/UseMarmo/marmo/actions/workflows/desktop.yml)
[![SDK CI](https://github.com/UseMarmo/marmo/actions/workflows/sdk.yml/badge.svg)](https://github.com/UseMarmo/marmo/actions/workflows/sdk.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Rust](https://img.shields.io/badge/Rust-1.88-CE422B?logo=rust&logoColor=white)](https://www.rust-lang.org)
[![Solidity](https://img.shields.io/badge/Solidity-0.8.28-363636?logo=solidity&logoColor=white)](https://soliditylang.org)
[![Hono](https://img.shields.io/badge/Hono-4.x-E36002)](https://hono.dev)
[![Tauri](https://img.shields.io/badge/Tauri-2-24C8DB?logo=tauri&logoColor=white)](https://tauri.app)
[![Hardhat](https://img.shields.io/badge/Hardhat-2.x-FFF100)](https://hardhat.org)
[![Base](https://img.shields.io/badge/Base-mainnet-0052FF?logo=coinbase&logoColor=white)](https://base.org)
[![base-sdk](https://img.shields.io/npm/v/@usemarmo/base-sdk?label=%40usemarmo%2Fbase-sdk)](https://www.npmjs.com/package/@usemarmo/base-sdk)

Self-custody infrastructure for Base. A wallet splits into three shards: one on your device, one on a co-signer, one in recovery. Any two can spend. No single one ever can.

---

## How it works

Marmo uses a 2-of-3 threshold scheme. Three shards are created at wallet setup:

| Shard | Holder | Technology |
|---|---|---|
| A | Your device / USB drive | secp256k1 key |
| B | Marmo co-signer | secp256k1 key, AES-256-GCM encrypted at rest |
| C | Recovery | Passkey / zkLogin |

The wallet is an ERC-4337 smart account on Base that enforces the 2-of-3 rule at the contract level. Spending requires any two shard signatures combined into a 130-byte ECDSA payload.

---

## Repo layout

```
marmo/
  src/              co-signer server (Hono, Bun, Postgres)
  db/migrations/    Postgres schema migrations
  contract/         ERC-4337 smart contracts (Hardhat, Solidity 0.8.28)
  desktop/          Desktop wallet (Tauri v2, Vite, TypeScript)
  base-sdk/         @usemarmo/base-sdk
```

Each sub-project has its own `package.json`, lockfile, and CI workflow.

---

## Deployments

| Service | URL |
|---|---|
| Co-signer API | https://api.usemarmo.xyz |
| Landing | https://usemarmo.xyz |

---

## Getting started

See [CONTRIBUTING.md](CONTRIBUTING.md) for dev setup instructions.

---

## License

[MIT](LICENSE)
