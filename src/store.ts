import { sql } from "./db/index.js";

export interface ShardRecord {
  shardId: string;
  address: string;
  encPrivateKey: string;
}

export interface WalletRecord {
  address: string;
  shardId: string;
  apiKeyHash: string;
  shardAAddress: string;
  shardCAddress: string;
  stealthMetaAddress?: string;
  encViewPriv?: string;
  totpSecret?: string;
  totpEnabled: boolean;
  encVaultKeys?: string;
  createdAt: string;
}

export async function pingStore(): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}

export async function putShard(record: ShardRecord): Promise<void> {
  await sql`
    insert into marmo_shards (shard_id, address, enc_private_key)
    values (${record.shardId}, ${record.address}, ${record.encPrivateKey})
    on conflict (shard_id) do nothing`;
}

export async function getShard(shardId: string): Promise<ShardRecord | undefined> {
  const rows = await sql`
    select shard_id, address, enc_private_key from marmo_shards where shard_id = ${shardId}`;
  const row = rows[0];
  if (!row) return undefined;
  return { shardId: row.shard_id, address: row.address, encPrivateKey: row.enc_private_key };
}

export async function putWallet(record: WalletRecord): Promise<void> {
  await sql`
    insert into marmo_wallets
      (address, shard_id, api_key_hash, shard_a_address, shard_c_address)
    values
      (${record.address}, ${record.shardId}, ${record.apiKeyHash},
       ${record.shardAAddress}, ${record.shardCAddress})
    on conflict (address) do update
      set api_key_hash = excluded.api_key_hash`;
}

export async function putStealthMeta(address: string, stealthMetaAddress: string, encViewPriv: string): Promise<void> {
  await sql`
    update marmo_wallets
       set stealth_meta_address = ${stealthMetaAddress},
           enc_view_priv = ${encViewPriv}
     where address = ${address}`;
}

export async function putTotp(address: string, encSecret: string): Promise<void> {
  await sql`
    update marmo_wallets
       set totp_secret = ${encSecret}, totp_enabled = false
     where address = ${address}`;
}

export async function enableTotp(address: string): Promise<void> {
  await sql`update marmo_wallets set totp_enabled = true where address = ${address}`;
}

export async function putVaultKeys(address: string, encVaultKeys: string): Promise<void> {
  await sql`update marmo_wallets set enc_vault_keys = ${encVaultKeys} where address = ${address}`;
}

export async function getWallet(address: string): Promise<WalletRecord | undefined> {
  const rows = await sql`
    select address, shard_id, api_key_hash, shard_a_address, shard_c_address,
           stealth_meta_address, enc_view_priv, totp_secret, totp_enabled, enc_vault_keys, created_at
    from marmo_wallets where address = ${address}`;
  const row = rows[0];
  if (!row) return undefined;
  return {
    address: row.address,
    shardId: row.shard_id,
    apiKeyHash: row.api_key_hash,
    shardAAddress: row.shard_a_address,
    shardCAddress: row.shard_c_address,
    stealthMetaAddress: row.stealth_meta_address ?? undefined,
    encViewPriv: row.enc_view_priv ?? undefined,
    totpSecret: row.totp_secret ?? undefined,
    totpEnabled: row.totp_enabled ?? false,
    encVaultKeys: row.enc_vault_keys ?? undefined,
    createdAt: row.created_at,
  };
}
