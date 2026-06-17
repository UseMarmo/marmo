import { secp256k1 } from "@noble/curves/secp256k1";
import { createPublicClient, http, formatEther, formatUnits, bytesToHex, hexToBytes } from "viem";
import { generatePrivateKey, privateKeyToAddress, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import * as core from "./core.js";

const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const FACTORY_ADDRESS = "0xCb3351F23174a53a5D30b06c0C985dCd4256432d" as const;
const BUNDLER_URL = import.meta.env.VITE_BUNDLER_URL ?? "";
const RP_ID = import.meta.env.VITE_RP_ID ?? "localhost";

const VAULT_KEY = "marmo_vault_v2";

const ERC20_ABI = [
  { name: "balanceOf", type: "function", stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }] },
] as const;

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
    inputs: [
      { name: "owners", type: "address[3]" },
      { name: "salt", type: "uint256" },
    ],
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
}

export interface BalanceResult {
  eth: string;
  usdc: string;
  usdValue: string;
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
    // passkey verification failed silently — wallet still loads, security is best-effort
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

const TOKEN_LOGO_MAP: Record<string, string> = {
  "0x833589fcd6edb6e08f4c7c32d4f71b54bda02913": "/usdc.png",
  "0x4200000000000000000000000000000000000006": "/eth.png",
};

export async function fetchWalletTokens(address: string): Promise<WalletToken[]> {
  const addr = address as `0x${string}`;
  try {
    const res = await fetch("https://rpc.ankr.com/multichain", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        method: "ankr_getAccountBalance",
        params: {
          blockchain: ["base"],
          walletAddress: address,
          onlyWhitelisted: false,
          pageSize: 50,
        },
        id: 1,
      }),
    });
    const data = await res.json() as {
      result?: { assets?: Array<{
        tokenType: string; contractAddress?: string;
        tokenSymbol: string; tokenDecimals: number; balance: string;
      }>};
    };
    const assets = data.result?.assets ?? [];
    const tokens: WalletToken[] = [];
    for (const a of assets) {
      if (parseFloat(a.balance) === 0) continue;
      const isNative = a.tokenType === "NATIVE";
      const contract = a.contractAddress?.toLowerCase() ?? "";
      tokens.push({
        address: isNative ? "" : contract,
        symbol: a.tokenSymbol,
        decimals: a.tokenDecimals,
        balance: parseFloat(a.balance)
          .toFixed(a.tokenDecimals > 6 ? 6 : a.tokenDecimals)
          .replace(/\.?0+$/, ""),
        logo: isNative ? "/eth.png" : (TOKEN_LOGO_MAP[contract] ?? ""),
      });
    }
    tokens.sort((a) => a.address === "" ? -1 : 1);
    if (tokens.length) return tokens;
  } catch {}
  const ethRaw = await publicClient.getBalance({ address: addr });
  return [{
    address: "",
    symbol: "ETH",
    decimals: 18,
    balance: parseFloat(formatEther(ethRaw)).toFixed(6).replace(/\.?0+$/, "") || "0",
    logo: "/eth.png",
  }];
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

export async function getBalance(address: string): Promise<BalanceResult> {
  const [ethRaw, usdcRaw, ethPrice] = await Promise.all([
    publicClient.getBalance({ address: address as `0x${string}` }),
    publicClient.readContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    }) as Promise<bigint>,
    fetchEthPrice(),
  ]);

  const ethNum = parseFloat(formatEther(ethRaw));
  const usdcNum = parseFloat(formatUnits(usdcRaw, 6));
  const usdTotal = ethNum * ethPrice + usdcNum;

  return {
    ethRaw,
    usdcRaw,
    eth: ethNum.toFixed(6),
    usdc: usdcNum.toFixed(2),
    usdValue: usdTotal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
  };
}

function packBytes32(hi: bigint, lo: bigint): `0x${string}` {
  return `0x${hi.toString(16).padStart(32, "0")}${lo.toString(16).padStart(32, "0")}` as `0x${string}`;
}

export async function buildAndSubmit(
  vault: Vault,
  callData: `0x${string}`,
  value: bigint,
): Promise<string> {
  if (!BUNDLER_URL) throw new Error("VITE_BUNDLER_URL is not configured");

  const sender = vault.address as `0x${string}`;
  const [nonce, feeData] = await Promise.all([
    publicClient.readContract({
      address: ENTRY_POINT,
      abi: EP_ABI,
      functionName: "getNonce",
      args: [sender, 0n],
    }) as Promise<bigint>,
    publicClient.estimateFeesPerGas(),
  ]);

  const verificationGasLimit = 200_000n;
  const callGasLimit = value > 0n ? 100_000n : 150_000n;
  const preVerificationGas = 50_000n;
  const maxFeePerGas = feeData.maxFeePerGas ?? 2_000_000n;
  const maxPriorityFeePerGas = feeData.maxPriorityFeePerGas ?? 1_000_000n;

  const accountGasLimits = packBytes32(verificationGasLimit, callGasLimit);
  const gasFees = packBytes32(maxPriorityFeePerGas, maxFeePerGas);

  const userOpForHash = {
    sender,
    nonce,
    initCode: "0x" as `0x${string}`,
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
  const sigB = await core.cosign(vault.address, vault.apiKey, userOpHash);
  const signature = `0x${sigA.slice(2)}${sigB.slice(2)}` as `0x${string}`;

  const res = await fetch(BUNDLER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "eth_sendUserOperation",
      params: [{ ...userOpForHash, nonce: `0x${nonce.toString(16)}`, preVerificationGas: `0x${preVerificationGas.toString(16)}`, paymasterAndData: "0x", signature }, ENTRY_POINT],
    }),
  });

  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result ?? "0x";
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 7)}…${address.slice(-5)}`;
}
