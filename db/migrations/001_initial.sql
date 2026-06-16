create table marmo_shards (
  shard_id        text primary key,
  address         text not null unique,
  enc_private_key text not null,
  created_at      timestamptz not null default now()
);

create table marmo_wallets (
  address         text primary key,
  shard_id        text not null references marmo_shards (shard_id),
  api_key_hash    text not null,
  shard_a_address text not null,
  shard_c_address text not null,
  daily_limit_usd double precision not null default 1000,
  spent_today_usd double precision not null default 0,
  spent_date      text not null,
  created_at      timestamptz not null default now()
);
