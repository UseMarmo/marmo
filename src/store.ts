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

export async function getWallet(address: string): Promise<WalletRecord | undefined> {
  const rows = await sql`
    select address, shard_id, api_key_hash, shard_a_address, shard_c_address, created_at
    from marmo_wallets where address = ${address}`;
  const row = rows[0];
  if (!row) return undefined;
  return {
    address: row.address,
    shardId: row.shard_id,
    apiKeyHash: row.api_key_hash,
    shardAAddress: row.shard_a_address,
    shardCAddress: row.shard_c_address,
    createdAt: row.created_at,
  };
}
