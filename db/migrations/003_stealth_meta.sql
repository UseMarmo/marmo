alter table marmo_wallets
  add column if not exists stealth_meta_address text,
  add column if not exists enc_view_priv        text;
