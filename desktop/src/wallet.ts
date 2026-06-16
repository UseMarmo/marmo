import { Shard, MarmoWallet, createClient, buildTransferSui, submit } from "@marmoxyz/sui-kit";
import { Ed25519PublicKey } from "@mysten/sui/keypairs/ed25519";
import { MIST_PER_SUI, toBase64 } from "@mysten/sui/utils";
import { getFaucetHost, requestSuiFromFaucetV2 } from "@mysten/sui/faucet";
import { save, open } from "@tauri-apps/plugin-dialog";
import { writeTextFile, readTextFile, exists, mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";
import * as core from "./core.js";

export type NetworkName = "testnet" | "mainnet";

const NETWORK: NetworkName = "testnet";
const VAULT_PATH = "marmo/vault.json";
const client = createClient(NETWORK);

export interface MemberRecord {
  label: string;
  publicKey: string;
  secret?: string;
  shardId?: string;
  apiKey?: string;
}

export interface Vault {
  address: string;
  threshold: number;
  network: NetworkName;
  members: MemberRecord[];
}

interface DriveFile {
  label: string;
  address: string;
  secret: string;
}

let driveShard: Shard | null = null;

function memberToWalletInput(member: MemberRecord) {
  return { publicKey: new Ed25519PublicKey(member.publicKey), weight: 1 };
}

export function walletFromVault(vault: Vault): MarmoWallet {
  return MarmoWallet.from({
    members: vault.members.map(memberToWalletInput),
    threshold: vault.threshold,
  });
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

export interface CreatedWallet {
  vault: Vault;
  driveSaved: boolean;
}

export async function createWallet(): Promise<CreatedWallet> {
  const drive = Shard.create("drive");
  const recovery = Shard.create("recovery");

  const serverShard = await core.createServerShard();
  const serverPublicKey = new Ed25519PublicKey(serverShard.publicKey);

  const wallet = MarmoWallet.from({
    members: [drive, { publicKey: serverPublicKey }, recovery],
    threshold: 2,
  });

  const apiKey = await core.registerWallet(wallet.address, serverShard.shardId);

  const vault: Vault = {
    address: wallet.address,
    threshold: 2,
    network: NETWORK,
    members: [
      { label: "drive", publicKey: drive.publicKey.toBase64() },
      { label: "server", publicKey: serverShard.publicKey, shardId: serverShard.shardId, apiKey },
      { label: "recovery", publicKey: recovery.publicKey.toBase64(), secret: recovery.exportSecret() },
    ],
  };

  await saveVault(vault);
  driveShard = drive;

  const driveSaved = await exportDriveShard(drive);
  return { vault, driveSaved };
}

async function exportDriveShard(drive: Shard): Promise<boolean> {
  const path = await save({
    title: "Save your drive shard",
    defaultPath: "marmo-drive-shard.json",
    filters: [{ name: "Marmo shard", extensions: ["json"] }],
  });
  if (!path) return false;

  const file: DriveFile = {
    label: "drive",
    address: drive.address,
    secret: drive.exportSecret(),
  };
  await writeTextFile(path, JSON.stringify(file, null, 2));
  return true;
}

export async function connectDrive(): Promise<boolean> {
  const path = await open({
    title: "Plug in and select your drive shard",
    multiple: false,
    directory: false,
    filters: [{ name: "Marmo shard", extensions: ["json"] }],
  });
  if (!path || typeof path !== "string") return false;

  const raw = await readTextFile(path);
  const file = JSON.parse(raw) as DriveFile;
  driveShard = Shard.fromSecret(file.secret, "drive");
  return true;
}

export function isDriveConnected(): boolean {
  return driveShard !== null;
}

export async function getBalanceSui(address: string): Promise<number> {
  const { totalBalance } = await client.getBalance({ owner: address });
  return Number(totalBalance) / Number(MIST_PER_SUI);
}

export async function requestFaucet(address: string): Promise<void> {
  await requestSuiFromFaucetV2({ host: getFaucetHost(NETWORK), recipient: address });
}

export interface SendResult {
  digest: string;
  status: string;
  explorer: string;
}

export async function send(vault: Vault, recipient: string, amountSui: number): Promise<SendResult> {
  if (!driveShard) throw new Error("Drive not connected");

  const server = vault.members.find((m) => m.label === "server");
  if (!server?.apiKey) throw new Error("Co-signer is not configured for this wallet");

  const wallet = walletFromVault(vault);
  const txBytes = await buildTransferSui(client, wallet, recipient, amountSui);

  const driveSignature = await driveShard.sign(txBytes);
  const serverSignature = await core.cosign(vault.address, server.apiKey, toBase64(txBytes), amountSui);

  const result = await submit(client, wallet, txBytes, [driveSignature, serverSignature]);

  return {
    digest: result.digest,
    status: result.effects?.status.status ?? "unknown",
    explorer: `https://suiscan.xyz/${NETWORK}/tx/${result.digest}`,
  };
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 7)}…${address.slice(-5)}`;
}

export { NETWORK };
