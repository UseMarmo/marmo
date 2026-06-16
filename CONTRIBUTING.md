# Contributing to Marmo

## Prerequisites

- [Bun](https://bun.sh) 1.x
- [Rust](https://rustup.rs) 1.88+ (desktop only)
- Node.js 20+ (contract only)

## Repo layout

| Path | What it is |
|---|---|
| `src/` | Co-signer server (Hono + Bun) |
| `db/migrations/` | Postgres migrations |
| `contract/` | ERC-4337 smart contracts (Hardhat) |
| `desktop/` | Desktop wallet (Tauri v2 + Vite) |
| `base-sdk/` | `@usemarmo/base-sdk` |

Each sub-project has its own `package.json` and lockfile. Install deps per-project, not from the root.

## Development

**Co-signer:**
```bash
cp .env.example .env
bun install
bun dev
```

**Contracts:**
```bash
cd contract
bun install
bunx hardhat compile
bunx hardhat test
```

**Desktop:**
```bash
cd desktop
bun install
bun tauri dev
```

**Base SDK:**
```bash
cd base-sdk
bun install
bun dev
```

## Pull requests

1. Branch off `main`
2. Keep changes focused, one concern per PR
3. Ensure CI passes before requesting review
4. No comments in code unless the reason is genuinely non-obvious

## Code style

- TypeScript on the JS side, Rust for the Tauri shell
- No inline comments that describe what the code does
- Solidity 0.8.28, Cancun EVM target
