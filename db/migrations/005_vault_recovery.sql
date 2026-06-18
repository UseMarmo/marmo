alter table marmo_wallets
  add column if not exists enc_vault_keys text;
