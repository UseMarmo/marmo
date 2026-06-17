import { secp256k1 } from "@noble/curves/secp256k1";
import { createPublicClient, http, formatEther, formatUnits, bytesToHex, hexToBytes } from "viem";
import { generatePrivateKey, privateKeyToAddress, privateKeyToAccount } from "viem/accounts";
import { base } from "viem/chains";
import { save } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile, exists, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import * as core from "./core.js";

const ENTRY_POINT = "0x0000000071727De22E5E9d8BAf0edAc6f37da032" as const;
const USDC = "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913" as const;
const FACTORY_ADDRESS = "0xCb3351F23174a53a5D30b06c0C985dCd4256432d" as const;
const BUNDLER_URL = import.meta.env.VITE_BUNDLER_URL ?? "";

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

const VAULT_PATH = "marmo/vault.json";

export interface Vault {
  address: string;
  shardAPrivKey: `0x${string}`;
  shardCPrivKey: `0x${string}`;
  spendPrivKey: `0x${string}`;
  viewPrivKey: `0x${string}`;
  credentialId: string;
  apiKey: string;
  network: "base";
}

export interface BalanceResult {
  ethRaw: bigint;
  usdcRaw: bigint;
  eth: string;
  usdc: string;
}

export interface SendResult {
  userOpHash: string;
  explorer: string;
}

async function ensureVaultDir(): Promise<void> {
  const there = await exists("marmo", { baseDir: BaseDirectory.AppLocalData });
  if (!there) await mkdir("marmo", { baseDir: BaseDirectory.AppLocalData, recursive: true });
}

export async function vaultExists(): Promise<boolean> {
  return exists(VAULT_PATH, { baseDir: BaseDirectory.AppLocalData });
}

export async function loadVault(): Promise<Vault> {
  const raw = await readTextFile(VAULT_PATH, { baseDir: BaseDirectory.AppLocalData });
  return JSON.parse(raw) as Vault;
}

async function saveVault(vault: Vault): Promise<void> {
  await ensureVaultDir();
  await writeTextFile(VAULT_PATH, JSON.stringify(vault, null, 2), {
    baseDir: BaseDirectory.AppLocalData,
  });
}

async function createPasskeyCredential(): Promise<string> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const userId = crypto.getRandomValues(new Uint8Array(16));

  const cred = (await navigator.credentials.create({
    publicKey: {
      challenge,
      rp: { name: "Marmo", id: "localhost" },
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

  if (!cred) throw new Error("Passkey creation was cancelled");
  return btoa(String.fromCharCode(...new Uint8Array(cred.rawId)));
}

export async function verifyPasskey(credentialId: string): Promise<void> {
  const challenge = crypto.getRandomValues(new Uint8Array(32));
  const rawId = Uint8Array.from(atob(credentialId), (c) => c.charCodeAt(0));

  const assertion = (await navigator.credentials.get({
    publicKey: {
      challenge,
      rpId: "localhost",
      allowCredentials: [{ type: "public-key", id: rawId }],
      userVerification: "required",
      timeout: 60_000,
    },
  })) as PublicKeyCredential | null;

  if (!assertion) throw new Error("Passkey authentication failed or was cancelled");
}

function privKeyToCompressedPub(privKey: `0x${string}`): `0x${string}` {
  const bytes = hexToBytes(privKey);
  const pub = secp256k1.getPublicKey(bytes, true);
  return bytesToHex(pub);
}

export function getStealthMetaAddress(vault: Vault): string {
  const spendPub = privKeyToCompressedPub(vault.spendPrivKey).slice(2);
  const viewPub = privKeyToCompressedPub(vault.viewPrivKey).slice(2);
  return `0x${spendPub}${viewPub}`;
}

async function resolveSmartAccountAddress(
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

export async function createWallet(): Promise<{ vault: Vault }> {
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

  const address = await resolveSmartAccountAddress(shardAAddress, shardBAddress, shardCAddress);

  const vault: Vault = {
    address,
    shardAPrivKey,
    shardCPrivKey,
    spendPrivKey,
    viewPrivKey,
    credentialId,
    apiKey,
    network: "base",
  };

  await saveVault(vault);
  await exportShardA(shardAPrivKey, address);

  return { vault };
}

async function exportShardA(shardAPrivKey: `0x${string}`, address: string): Promise<void> {
  const path = await save({
    title: "Save your device shard backup",
    defaultPath: "marmo-device-shard.json",
    filters: [{ name: "Marmo shard", extensions: ["json"] }],
  });
  if (!path) return;
  await writeTextFile(path, JSON.stringify({ address, shardAPrivKey }, null, 2));
}

export async function getBalance(address: string): Promise<BalanceResult> {
  const [ethRaw, usdcRaw] = await Promise.all([
    publicClient.getBalance({ address: address as `0x${string}` }),
    publicClient.readContract({
      address: USDC,
      abi: ERC20_ABI,
      functionName: "balanceOf",
      args: [address as `0x${string}`],
    }) as Promise<bigint>,
  ]);

  return {
    ethRaw,
    usdcRaw,
    eth: parseFloat(formatEther(ethRaw)).toFixed(6),
    usdc: parseFloat(formatUnits(usdcRaw, 6)).toFixed(2),
  };
}

function packBytes32(hi: bigint, lo: bigint): `0x${string}` {
  return `0x${hi.toString(16).padStart(32, "0")}${lo.toString(16).padStart(32, "0")}` as `0x${string}`;
}

async function buildAndSubmitUserOp(
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

  const shardAAccount = privateKeyToAccount(vault.shardAPrivKey);
  const sigA = await shardAAccount.signMessage({ message: { raw: hexToBytes(userOpHash) } });
  const sigB = await core.cosign(vault.address, vault.apiKey, userOpHash);

  const signature = `0x${sigA.slice(2)}${sigB.slice(2)}` as `0x${string}`;

  const userOp = {
    sender,
    nonce: `0x${nonce.toString(16)}`,
    initCode: "0x",
    callData,
    accountGasLimits,
    preVerificationGas: `0x${preVerificationGas.toString(16)}`,
    gasFees,
    paymasterAndData: "0x",
    signature,
  };

  const res = await fetch(BUNDLER_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "eth_sendUserOperation",
      params: [userOp, ENTRY_POINT],
    }),
  });

  const json = (await res.json()) as { result?: string; error?: { message: string } };
  if (json.error) throw new Error(json.error.message);
  return json.result ?? "0x";
}

export async function send(
  vault: Vault,
  to: string,
  amount: string,
  token?: string,
): Promise<SendResult> {
  const { callData, value } = await core.buildSend(vault.address, vault.apiKey, to, amount, token);
  const userOpHash = await buildAndSubmitUserOp(vault, callData, BigInt(value));
  return { userOpHash, explorer: `https://basescan.org/tx/${userOpHash}` };
}

export async function stealthSend(
  vault: Vault,
  recipientMetaAddress: string,
  amount: string,
  token?: string,
): Promise<SendResult & { stealthAddress: string }> {
  const result = await core.buildStealthSend(
    vault.address, vault.apiKey, recipientMetaAddress, amount, token,
  );
  const userOpHash = await buildAndSubmitUserOp(vault, result.callData, BigInt(result.value));
  return {
    userOpHash,
    stealthAddress: result.stealthAddress,
    explorer: `https://basescan.org/tx/${userOpHash}`,
  };
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 7)}…${address.slice(-5)}`;
}
