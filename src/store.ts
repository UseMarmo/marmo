import postgres from "postgres";

export interface ShardRecord {
  shardId: string;
  publicKey: string;
  encSecret: string;
}

export interface WalletRecord {
  address: string;
  shardId: string;
  apiKeyHash: string;
  members: string[];
  dailyLimitSui: number;
  spentTodaySui: number;
  spentDate: string;
  createdAt: string;
}

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) throw new Error("DATABASE_URL is not set");

const sql = postgres(DATABASE_URL, { prepare: false, ssl: "require", max: 5 });

export async function pingStore(): Promise<boolean> {
  try {
    await sql`select 1`;
    return true;
  } catch {
    return false;
  }
}

export async function initStore(): Promise<void> {
  await sql`
    create table if not exists marmo_shards (
      shard_id text primary key,
      public_key text not null,
      enc_secret text not null,
      created_at timestamptz not null default now()
    )`;
  await sql`
    create table if not exists marmo_wallets (
      address text primary key,
      shard_id text not null references marmo_shards (shard_id),
      api_key_hash text not null,
      members jsonb not null default '[]',
      daily_limit_sui double precision not null default 1000,
      spent_today_sui double precision not null default 0,
      spent_date text not null,
      created_at timestamptz not null default now()
    )`;
}

export async function putShard(record: ShardRecord): Promise<void> {
  await sql`
    insert into marmo_shards (shard_id, public_key, enc_secret)
    values (${record.shardId}, ${record.publicKey}, ${record.encSecret})
    on conflict (shard_id) do update
      set public_key = excluded.public_key, enc_secret = excluded.enc_secret`;
}

export async function getShard(shardId: string): Promise<ShardRecord | undefined> {
  const rows = await sql`
    select shard_id, public_key, enc_secret from marmo_shards where shard_id = ${shardId}`;
  const row = rows[0];
  if (!row) return undefined;
  return { shardId: row.shard_id, publicKey: row.public_key, encSecret: row.enc_secret };
}

export async function putWallet(record: WalletRecord): Promise<void> {
  await sql`
    insert into marmo_wallets
      (address, shard_id, api_key_hash, members, daily_limit_sui, spent_today_sui, spent_date)
    values
      (${record.address}, ${record.shardId}, ${record.apiKeyHash}, ${sql.json(record.members)},
       ${record.dailyLimitSui}, ${record.spentTodaySui}, ${record.spentDate})
    on conflict (address) do update
      set api_key_hash = excluded.api_key_hash, members = excluded.members,
          daily_limit_sui = excluded.daily_limit_sui,
          spent_today_sui = excluded.spent_today_sui, spent_date = excluded.spent_date`;
}

export async function getWallet(address: string): Promise<WalletRecord | undefined> {
  const rows = await sql`
    select address, shard_id, api_key_hash, members, daily_limit_sui,
           spent_today_sui, spent_date, created_at
    from marmo_wallets where address = ${address}`;
  const row = rows[0];
  if (!row) return undefined;
  return {
    address: row.address,
    shardId: row.shard_id,
    apiKeyHash: row.api_key_hash,
    members: row.members,
    dailyLimitSui: Number(row.daily_limit_sui),
    spentTodaySui: Number(row.spent_today_sui),
    spentDate: row.spent_date,
    createdAt: row.created_at,
  };
}

export async function saveWallet(record: WalletRecord): Promise<void> {
  await putWallet(record);
}
