import { secp256k1 } from "@noble/curves/secp256k1";
import { createPublicClient, createWalletClient, http, formatEther, formatUnits, bytesToHex, hexToBytes, encodeFunctionData, keccak256, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAddress, privateKeyToAccount, publicKeyToAddress } from "viem/accounts";
import { base } from "viem/chains";
import * as core from "./core.js";

const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const FACTORY_ADDRESS = "0xCb3351F23174a53a5D30b06c0C985dCd4256432d" as const;
const BUNDLER_URL = import.meta.env.VITE_BUNDLER_URL ?? "";
const RP_ID = import.meta.env.VITE_RP_ID ?? "localhost";

const VAULT_KEY = "marmo_vault_v2";


const EP_ABI = [
  { name: "getNonce", type: "function", stateMutability: "view",
    inputs: [{ name: "sender", type: "address" }, { name: "key", type: "uint192" }],
    outputs: [{ type: "uint256" }] },
  { name: "getUserOpHash", type: "function", stateMutability: "view",
    inputs: [{ name: "userOp", type: "tuple", components: [
      { name: "sender", type: "address" },
      { name: "nonce", type: "uint256" },
      { name: "initCode", type: "bytes" },
      { name: "callData", type: "bytes" },
      { name: "accountGasLimits", type: "bytes32" },
      { name: "preVerificationGas", type: "uint256" },
      { name: "gasFees", type: "bytes32" },
      { name: "paymasterAndData", type: "bytes" },
      { name: "signature", type: "bytes" },
    ]}],
    outputs: [{ type: "bytes32" }] },
] as const;

const FACTORY_ABI = [
  { name: "predictAddress", type: "function", stateMutability: "view",
    inputs: [{ name: "owners", type: "address[3]" }, { name: "salt", type: "uint256" }],
    outputs: [{ type: "address" }] },
  { name: "createAccount", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "owners", type: "address[3]" }, { name: "salt", type: "uint256" }],
    outputs: [{ type: "address" }] },
] as const;

const publicClient = createPublicClient({ chain: base, transport: http() });

export interface Vault {
  address: string;
  shardAPrivKey: `0x${string}`;
  shardCPrivKey: `0x${string}`;
  spendPrivKey: `0x${string}`;
  viewPrivKey: `0x${string}`;
  credentialId: string;
  apiKey: string;
  shardBAddress?: string;
  totpEnabled?: boolean;
}

export interface BalanceResult {
  eth: string;
  usdc: string;
  usdValue: string;
  ethUsdValue: string;
  ethRaw: bigint;
  usdcRaw: bigint;
}

export function vaultExists(): boolean {
  return !!localStorage.getItem(VAULT_KEY);
}

export function loadVault(): Vault {
  const raw = localStorage.getItem(VAULT_KEY);
  if (!raw) throw new Error("No vault found");
  return JSON.parse(raw) as Vault;
}

function saveVault(vault: Vault): void {
  localStorage.setItem(VAULT_KEY, JSON.stringify(vault));
}

async function createPasskeyCredential(): Promise<string> {
  if (!window.PublicKeyCredential) return "";
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));

    const cred = (await navigator.credentials.create({
      publicKey: {
        challenge,
        rp: { name: "Marmo", id: RP_ID },
        user: { id: userId, name: "marmo-wallet", displayName: "Marmo Wallet" },
        pubKeyCredParams: [
          { type: "public-key", alg: -7 },
          { type: "public-key", alg: -257 },
        ],
        authenticatorSelection: {
          requireResidentKey: true,
          residentKey: "required",
          userVerification: "required",
        },
        timeout: 60_000,
      },
    })) as PublicKeyCredential | null;

    if (!cred) return "";
    return btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
  } catch {
    return "";
  }
}

export async function verifyPasskey(credentialId: string): Promise<void> {
  if (!credentialId) return;
  if (!window.PublicKeyCredential) return;
  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const rawId = Uint8Array.from(atob(credentialId), (c) => c.charCodeAt(0));

    await navigator.credentials.get({
      publicKey: {
        challenge,
        rpId: RP_ID,
        allowCredentials: [{ type: "public-key", id: rawId }],
        userVerification: "required",
        timeout: 60_000,
      },
    });
  } catch {
  }
}

function privKeyToCompressedPub(privKey: `0x${string}`): `0x${string}` {
  return bytesToHex(secp256k1.getPublicKey(hexToBytes(privKey), true));
}

export function getStealthMetaAddress(vault: Vault): string {
  const spend = privKeyToCompressedPub(vault.spendPrivKey).slice(2);
  const view = privKeyToCompressedPub(vault.viewPrivKey).slice(2);
  return `0x${spend}${view}`;
}

export interface StealthToken {
  address: `0x${string}`;
  symbol: string;
  decimals: number;
  balance: string;
  raw: bigint;
}

export interface StealthPayment {
  stealthAddress: string;
  ephemeralPubKey: string;
  viewTag: number;
  blockNumber: string;
  txHash: string;
  stealthPrivKey: `0x${string}`;
  ethBalance: string;
  ethRaw: bigint;
  tokens: StealthToken[];
}

function numberToBytes32(n: bigint): Uint8Array {
  return hexToBytes(`0x${n.toString(16).padStart(64, "0")}`);
}

export function checkAnnouncement(
  ann: { ephemeralPubKey: string; stealthAddress: string; viewTag: number },
  viewPrivKey: `0x${string}`,
  spendPrivKey: `0x${string}`,
): { matches: boolean; stealthPrivKey?: `0x${string}` } {
  try {
    const R = secp256k1.ProjectivePoint.fromHex(ann.ephemeralPubKey.replace(/^0x/, ""));
    const S = R.multiply(BigInt(viewPrivKey));
    const h = keccak256(bytesToHex(numberToBytes32(S.toAffine().x)));

    if (parseInt(h.slice(2, 4), 16) !== ann.viewTag) return { matches: false };

    const hBig = BigInt(h) % secp256k1.CURVE.n;
    const spendPub = secp256k1.ProjectivePoint.fromPrivateKey(hexToBytes(spendPrivKey));
    const stealthPub = spendPub.add(secp256k1.ProjectivePoint.BASE.multiply(hBig));
    const derived = publicKeyToAddress(bytesToHex(stealthPub.toRawBytes(false)));

    if (derived.toLowerCase() !== ann.stealthAddress.toLowerCase()) return { matches: false };

    const stealthPrivBig = (BigInt(spendPrivKey) + hBig) % secp256k1.CURVE.n;
    const stealthPrivKey = `0x${stealthPrivBig.toString(16).padStart(64, "0")}` as `0x${string}`;
    return { matches: true, stealthPrivKey };
  } catch { return { matches: false }; }
}

export async function registerStealth(vault: Vault): Promise<void> {
  const cosignKey = privateKeyToAddress(vault.shardAPrivKey);
  await core.registerStealthMeta(cosignKey, vault.apiKey, getStealthMetaAddress(vault), vault.viewPrivKey);
}

export async function scanStealthPayments(vault: Vault): Promise<StealthPayment[]> {
  const cosignKey = privateKeyToAddress(vault.shardAPrivKey);
  const raw = await core.scanStealth(cosignKey, vault.apiKey);

  const matched: StealthPayment[] = [];
  for (const ann of raw.payments) {
    const result = checkAnnouncement(ann, vault.viewPrivKey, vault.spendPrivKey);
    if (!result.matches || !result.stealthPrivKey) continue;

    const addr = ann.stealthAddress as `0x${string}`;

    const [ethRaw, ...tokenRaws] = await Promise.all([
      publicClient.getBalance({ address: addr }).catch(() => 0n),
      ...BASE_TOKENS.map(t =>
        (publicClient.readContract({ address: t.address, abi: ERC20_ABI, functionName: "balanceOf", args: [addr] }) as Promise<bigint>)
          .catch(() => 0n),
      ),
    ]);

    const tokens: StealthToken[] = BASE_TOKENS
      .map((t, i) => ({ ...t, raw: tokenRaws[i], balance: formatUnits(tokenRaws[i], t.decimals) }))
      .filter(t => t.raw > 0n)
      .map(({ address, symbol, decimals, balance, raw }) => ({ address, symbol, decimals, balance, raw }));

    if (ethRaw === 0n && tokens.length === 0) continue;

    matched.push({
      ...ann,
      stealthPrivKey: result.stealthPrivKey,
      ethBalance: parseFloat(formatEther(ethRaw)).toFixed(6).replace(/\.?0+$/, ""),
      ethRaw,
      tokens,
    });
  }
  return matched;
}

export async function sweepStealthPayment(
  vault: Vault,
  payment: StealthPayment,
): Promise<string[]> {
  const { stealthPrivKey, stealthAddress, tokens } = payment;
  const toAddress = vault.address as `0x${string}`;
  const stealthAddr = stealthAddress as `0x${string}`;

  const account = privateKeyToAccount(stealthPrivKey);
  const walletClient = createWalletClient({ account, chain: base, transport: http() });

  const gasPrice = await publicClient.getGasPrice();
  const GAS_TOKEN = 65_000n;
  const GAS_ETH   = 21_000n;
  const totalGas  = (BigInt(tokens.length) * GAS_TOKEN + GAS_ETH) * gasPrice * 2n;

  const ethNow = await publicClient.getBalance({ address: stealthAddr });

  if (ethNow < totalGas) {
    const deficit = totalGas - ethNow;
    const serverKey = privateKeyToAddress(vault.shardAPrivKey);
    const cd = await core.buildSend(serverKey, vault.apiKey, stealthAddress, deficit.toString());
    const fundHash = await buildAndSubmit(vault, cd.callData, BigInt(cd.value));
    await publicClient.waitForTransactionReceipt({ hash: fundHash as `0x${string}` });
  }

  const hashes: string[] = [];

  for (const tok of tokens) {
    const data = encodeFunctionData({
      abi: ERC20_ABI,
      functionName: "transfer",
      args: [toAddress, tok.raw],
    });
    const h = await walletClient.sendTransaction({ to: tok.address, data });
    await publicClient.waitForTransactionReceipt({ hash: h });
    hashes.push(h);
  }

  const remainingEth = await publicClient.getBalance({ address: stealthAddr });
  const freshGasPrice = await publicClient.getGasPrice();
  const finalGasCost = freshGasPrice * GAS_ETH * 2n;
  if (remainingEth > finalGasCost) {
    const h = await walletClient.sendTransaction({
      to: toAddress,
      value: remainingEth - finalGasCost,
      gas: GAS_ETH,
    });
    hashes.push(h);
  }

  return hashes;
}

async function resolveAddress(
  shardAAddress: `0x${string}`,
  shardBAddress: `0x${string}`,
  shardCAddress: `0x${string}`,
): Promise<`0x${string}`> {
  return publicClient.readContract({
    address: FACTORY_ADDRESS,
    abi: FACTORY_ABI,
    functionName: "predictAddress",
    args: [[shardAAddress, shardBAddress, shardCAddress], 0n],
  }) as Promise<`0x${string}`>;
}

export async function initTotpSetup(vault: Vault): Promise<{ secret: string; uri: string }> {
  const serverKey = privateKeyToAddress(vault.shardAPrivKey);
  return core.setupTotp(serverKey, vault.apiKey);
}

export async function confirmTotpSetup(vault: Vault, code: string): Promise<Vault> {
  const serverKey = privateKeyToAddress(vault.shardAPrivKey);
  await core.confirmTotp(serverKey, vault.apiKey, code);
  const updated = { ...vault, totpEnabled: true };
  saveVault(updated);
  return updated;
}

export async function createWallet(): Promise<Vault> {
  const shardAPrivKey = generatePrivateKey();
  const shardAAddress = privateKeyToAddress(shardAPrivKey);
  const shardCPrivKey = generatePrivateKey();
  const shardCAddress = privateKeyToAddress(shardCPrivKey);
  const spendPrivKey = generatePrivateKey();
  const viewPrivKey = generatePrivateKey();

  const credentialId = await createPasskeyCredential();

  const { shardBAddress, apiKey } = await core.registerWallet(
    shardAAddress,
    shardAAddress,
    shardCAddress,
  );

  const address = await resolveAddress(shardAAddress, shardBAddress, shardCAddress);

  const vault: Vault = {
    address,
    shardAPrivKey,
    shardCPrivKey,
    spendPrivKey,
    viewPrivKey,
    credentialId,
    apiKey,
    shardBAddress,
  };

  saveVault(vault);
  return vault;
}

export interface WalletToken {
  address: string;
  symbol: string;
  decimals: number;
  balance: string;
  logo: string;
}

const BASE_TOKENS: Array<{ address: `0x${string}`; symbol: string; decimals: number; logo: string }> = [
  { address: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913", symbol: "USDC",  decimals: 6,  logo: "/usdc.png" },
  { address: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2", symbol: "USDT",  decimals: 6,  logo: "" },
  { address: "0x4200000000000000000000000000000000000006", symbol: "WETH",  decimals: 18, logo: "/eth.png" },
  { address: "0x50c5725949A6F0c72E6C4a641F24049A917DB0Cb", symbol: "DAI",   decimals: 18, logo: "" },
  { address: "0xd9aAEc86B65D86f6A7B5B1b0c42FFA531710b6CA", symbol: "USDbC", decimals: 6,  logo: "" },
  { address: "0x2Ae3F1Ec7F1F5012CFEab0185bfc7aa3cf0DEc22", symbol: "cbETH", decimals: 18, logo: "" },
];

const TOKEN_LOGO_MAP: Record<string, string> = Object.fromEntries(
  BASE_TOKENS.map(t => [t.address.toLowerCase(), t.logo])
);

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "", type: "address" }], outputs: [{ type: "uint256" }] },
  { name: "symbol",   type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "string" }] },
  { name: "decimals", type: "function", stateMutability: "view",
    inputs: [], outputs: [{ type: "uint8" }] },
  { name: "transfer", type: "function", stateMutability: "nonpayable",
    inputs: [{ name: "to", type: "address" }, { name: "amount", type: "uint256" }],
    outputs: [{ type: "bool" }] },
] as const;

const TRANSFER_SIG = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

export function loadCustomTokenAddresses(walletAddress: string): string[] {
  try {
    const raw = localStorage.getItem(`marmo_ctok_${walletAddress.toLowerCase()}`);
    return raw ? (JSON.parse(raw) as string[]) : [];
  } catch { return []; }
}

export function saveCustomTokenAddress(walletAddress: string, contractAddress: string): void {
  const existing = loadCustomTokenAddresses(walletAddress);
  const merged = [...new Set([...existing, contractAddress.toLowerCase()])];
  localStorage.setItem(`marmo_ctok_${walletAddress.toLowerCase()}`, JSON.stringify(merged));
}

export async function fetchTokenByAddress(walletAddress: string, contractAddress: string): Promise<WalletToken> {
  const addr = walletAddress as `0x${string}`;
  const c = contractAddress.toLowerCase() as `0x${string}`;
  const [bal, sym, dec] = await Promise.all([
    publicClient.readContract({ address: c, abi: ERC20_ABI, functionName: "balanceOf", args: [addr] }),
    publicClient.readContract({ address: c, abi: ERC20_ABI, functionName: "symbol" }),
    publicClient.readContract({ address: c, abi: ERC20_ABI, functionName: "decimals" }),
  ]);
  const d = Number(dec);
  return {
    address: c,
    symbol: sym as string,
    decimals: d,
    balance: parseFloat(formatUnits(bal as bigint, d)).toFixed(d > 6 ? 6 : d).replace(/\.?0+$/, "") || "0",
    logo: TOKEN_LOGO_MAP[c] ?? "",
  };
}

export async function fetchWalletTokens(address: string): Promise<WalletToken[]> {
  const addr = address as `0x${string}`;
  const customAddresses = loadCustomTokenAddresses(address);
  const knownAddresses = new Set(BASE_TOKENS.map(t => t.address.toLowerCase()));

  const currentBlock = await publicClient.getBlockNumber();
  const fromBlock = currentBlock > 9_900n ? currentBlock - 9_900n : 0n;
  const topicTo = `0x000000000000000000000000${addr.slice(2).toLowerCase()}`;

  const [ethRaw, ...knownResults] = await Promise.all([
    publicClient.getBalance({ address: addr }),
    ...BASE_TOKENS.map(async (t) => {
      try {
        const bal = await publicClient.readContract({
          address: t.address, abi: ERC20_ABI, functionName: "balanceOf", args: [addr],
        }) as bigint;
        if (bal === 0n) return null;
        return {
          address: t.address.toLowerCase(),
          symbol: t.symbol,
          decimals: t.decimals,
          balance: parseFloat(formatUnits(bal, t.decimals))
            .toFixed(t.decimals > 6 ? 6 : t.decimals).replace(/\.?0+$/, ""),
          logo: t.logo,
        } satisfies WalletToken;
      } catch { return null; }
    }),
  ]);

  const tokens: WalletToken[] = [{
    address: "",
    symbol: "ETH",
    decimals: 18,
    balance: parseFloat(formatEther(ethRaw)).toFixed(6).replace(/\.?0+$/, "") || "0",
    logo: "/eth.png",
  }];

  for (const t of knownResults) if (t) tokens.push(t);

  try {
    const res = await fetch("https://base-rpc.publicnode.com", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0", id: 1, method: "eth_getLogs",
        params: [{ fromBlock: `0x${fromBlock.toString(16)}`, toBlock: "latest",
          topics: [TRANSFER_SIG, null, topicTo] }],
      }),
    });
    const data = await res.json() as { result?: Array<{ address: string }> };
    const discovered = (data.result ?? [])
      .map(l => l.address.toLowerCase())
      .filter(a => !knownAddresses.has(a));
    const unique = [...new Set([...discovered, ...customAddresses.filter(a => !knownAddresses.has(a))])];

    const extra = await Promise.all(unique.map(async (contract) => {
      try {
        const c = contract as `0x${string}`;
        const [bal, sym, dec] = await Promise.all([
          publicClient.readContract({ address: c, abi: ERC20_ABI, functionName: "balanceOf", args: [addr] }),
          publicClient.readContract({ address: c, abi: ERC20_ABI, functionName: "symbol" }),
          publicClient.readContract({ address: c, abi: ERC20_ABI, functionName: "decimals" }),
        ]);
        if ((bal as bigint) === 0n) return null;
        const d = Number(dec);
        return {
          address: contract, symbol: sym as string, decimals: d,
          balance: parseFloat(formatUnits(bal as bigint, d))
            .toFixed(d > 6 ? 6 : d).replace(/\.?0+$/, ""),
          logo: TOKEN_LOGO_MAP[contract] ?? "",
        } satisfies WalletToken;
      } catch { return null; }
    }));
    for (const t of extra) if (t) tokens.push(t);
  } catch {}

  return tokens;
}

let priceCache: { value: number; ts: number } | null = null;
const PRICE_TTL = 2 * 60 * 1000;

export async function fetchEthPrice(): Promise<number> {
  if (priceCache && Date.now() - priceCache.ts < PRICE_TTL) return priceCache.value;
  try {
    const res = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
    const data = await res.json() as { ethereum?: { usd?: number } };
    const value = data.ethereum?.usd ?? 0;
    if (value > 0) priceCache = { value, ts: Date.now() };
    return value;
  } catch {
    return priceCache?.value ?? 0;
  }
}

const STABLECOIN_ADDRS = new Set([
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913",
  "0xfde4c96c8593536e31f229ea8f37b2ada2699bb2",
  "0x50c5725949a6f0c72e6c4a641f24049a917db0cb",
  "0xd9aaec86b65d86f6a7b5b1b0c42ffa531710b6ca",
]);
const ETH_LIKE_ADDRS = new Set([
  "0x4200000000000000000000000000000000000006",
  "0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22",
]);

export async function getBalance(address: string): Promise<BalanceResult> {
  const addr = address as `0x${string}`;

  const [ethRaw, ethPrice, ...tokenRaws] = await Promise.all([
    publicClient.getBalance({ address: addr }),
    fetchEthPrice(),
    ...BASE_TOKENS.map(t =>
      (publicClient.readContract({ address: t.address, abi: ERC20_ABI, functionName: "balanceOf", args: [addr] }) as Promise<bigint>)
        .catch(() => 0n)
    ),
  ]);

  const usdcIdx = BASE_TOKENS.findIndex(t => t.address.toLowerCase() === USDC.toLowerCase());
  const usdcRaw = usdcIdx >= 0 ? tokenRaws[usdcIdx] : 0n;

  const ethNum = parseFloat(formatEther(ethRaw));
  const usdcNum = parseFloat(formatUnits(usdcRaw, 6));

  let usdTotal = ethNum * ethPrice;
  for (let i = 0; i < BASE_TOKENS.length; i++) {
    const bal = parseFloat(formatUnits(tokenRaws[i], BASE_TOKENS[i].decimals));
    if (bal <= 0) continue;
    const a = BASE_TOKENS[i].address.toLowerCase();
    if (STABLECOIN_ADDRS.has(a)) usdTotal += bal;
    else if (ETH_LIKE_ADDRS.has(a)) usdTotal += bal * ethPrice;
  }

  const fmt = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

  return {
    ethRaw,
    usdcRaw,
    eth: ethNum.toFixed(6).replace(/\.?0+$/, "") || "0",
    usdc: usdcNum.toFixed(2),
    usdValue: fmt(usdTotal),
    ethUsdValue: fmt(ethNum * ethPrice),
  };
}

function packBytes32(hi: bigint, lo: bigint): `0x${string}` {
  return `0x${hi.toString(16).padStart(32, "0")}${lo.toString(16).padStart(32, "0")}` as `0x${string}`;
}

async function pimlicoGasPrice(): Promise<{ maxFeePerGas: bigint; maxPriorityFeePerGas: bigint }> {
  const res = await fetch(BUNDLER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "pimlico_getUserOperationGasPrice", params: [] }),
  });
  const data = await res.json() as {
    result: { fast: { maxFeePerGas: string; maxPriorityFeePerGas: string } };
  };
  return {
    maxFeePerGas: BigInt(data.result.fast.maxFeePerGas),
    maxPriorityFeePerGas: BigInt(data.result.fast.maxPriorityFeePerGas),
  };
}

async function pimlicoEstimateGas(userOp: Record<string, unknown>): Promise<{
  callGasLimit: bigint;
  verificationGasLimit: bigint;
  preVerificationGas: bigint;
}> {
  const res = await fetch(BUNDLER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 2,
      method: "eth_estimateUserOperationGas",
      params: [userOp, ENTRY_POINT],
    }),
  });
  const data = await res.json() as {
    result?: { callGasLimit: string; verificationGasLimit: string; preVerificationGas: string };
    error?: { message: string };
  };
  if (!data.result) throw new Error(data.error?.message ?? "Gas estimation failed");
  return {
    callGasLimit: BigInt(data.result.callGasLimit),
    verificationGasLimit: BigInt(data.result.verificationGasLimit),
    preVerificationGas: BigInt(data.result.preVerificationGas),
  };
}

export async function buildAndSubmit(
  vault: Vault,
  callData: `0x${string}`,
  value: bigint,
): Promise<string> {
  if (!BUNDLER_URL) throw new Error("VITE_BUNDLER_URL is not configured");

  const sender = vault.address as `0x${string}`;
  const shardAAddress = privateKeyToAddress(vault.shardAPrivKey);

  const [nonce, { maxFeePerGas, maxPriorityFeePerGas }] = await Promise.all([
    publicClient.readContract({
      address: ENTRY_POINT,
      abi: EP_ABI,
      functionName: "getNonce",
      args: [sender, 0n],
    }) as Promise<bigint>,
    pimlicoGasPrice(),
  ]);

  let isDeployed = false;
  try {
    const code = await publicClient.getCode({ address: sender });
    isDeployed = !!code && code !== "0x";
  } catch {
    isDeployed = false;
  }

  let factory: `0x${string}` | null = null;
  let factoryData: `0x${string}` | null = null;

  if (!isDeployed) {
    let shardB = vault.shardBAddress as `0x${string}` | undefined;
    if (!shardB) {
      const info = await core.getWalletInfo(shardAAddress);
      shardB = info.shardBAddress;
    }
    const shardCAddress = privateKeyToAddress(vault.shardCPrivKey);
    factory = FACTORY_ADDRESS;
    factoryData = encodeFunctionData({
      abi: FACTORY_ABI,
      functionName: "createAccount",
      args: [[shardAAddress, shardB, shardCAddress], 0n],
    });
  }

  const hex = (n: bigint) => `0x${n.toString(16)}`;

  const dummySig = `0x${"ec".repeat(65)}${"ec".repeat(65)}` as `0x${string}`;
  const estOp = {
    sender,
    nonce: hex(nonce),
    factory: factory ?? null,
    factoryData: factoryData ?? "0x",
    callData,
    maxFeePerGas: hex(maxFeePerGas),
    maxPriorityFeePerGas: hex(maxPriorityFeePerGas),
    signature: dummySig,
  };

  let verificationGasLimit: bigint;
  let callGasLimit: bigint;
  let preVerificationGas: bigint;

  try {
    const est = await pimlicoEstimateGas(estOp);
    verificationGasLimit = est.verificationGasLimit * 12n / 10n;
    callGasLimit = est.callGasLimit * 12n / 10n;
    preVerificationGas = est.preVerificationGas * 12n / 10n;
  } catch {
    verificationGasLimit = isDeployed ? 300_000n : 1_500_000n;
    callGasLimit = isDeployed ? 200_000n : 300_000n;
    preVerificationGas = 100_000n;
  }

  const initCode = factory
    ? (`0x${factory.slice(2)}${(factoryData ?? "0x").slice(2)}` as `0x${string}`)
    : ("0x" as `0x${string}`);

  const accountGasLimits = packBytes32(verificationGasLimit, callGasLimit);
  const gasFees = packBytes32(maxPriorityFeePerGas, maxFeePerGas);

  const userOpForHash = {
    sender,
    nonce,
    initCode,
    callData,
    accountGasLimits,
    preVerificationGas,
    gasFees,
    paymasterAndData: "0x" as `0x${string}`,
    signature: "0x" as `0x${string}`,
  };

  const userOpHash = (await publicClient.readContract({
    address: ENTRY_POINT,
    abi: EP_ABI,
    functionName: "getUserOpHash",
    args: [userOpForHash],
  })) as `0x${string}`;

  const sigA = await privateKeyToAccount(vault.shardAPrivKey).signMessage({
    message: { raw: hexToBytes(userOpHash) },
  });
  const cosignKey = shardAAddress;
  const sigB = await core.cosign(cosignKey, vault.apiKey, userOpHash);
  const signature = `0x${sigA.slice(2)}${sigB.slice(2)}` as `0x${string}`;

  const unpackedUserOp = {
    sender,
    nonce: hex(nonce),
    factory: factory ?? null,
    factoryData: factoryData ?? "0x",
    callData,
    callGasLimit: hex(callGasLimit),
    verificationGasLimit: hex(verificationGasLimit),
    preVerificationGas: hex(preVerificationGas),
    maxFeePerGas: hex(maxFeePerGas),
    maxPriorityFeePerGas: hex(maxPriorityFeePerGas),
    paymaster: null,
    paymasterVerificationGasLimit: "0x0",
    paymasterPostOpGasLimit: "0x0",
    paymasterData: "0x",
    signature,
  };

  const res = await fetch(BUNDLER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "eth_sendUserOperation",
      params: [unpackedUserOp, ENTRY_POINT],
    }),
  });

  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result ?? "0x";
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 7)}…${address.slice(-5)}`;
}
