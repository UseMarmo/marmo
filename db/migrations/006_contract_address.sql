alter table marmo_wallets
  add column if not exists contract_address text;

create index if not exists idx_marmo_wallets_contract_address
  on marmo_wallets (contract_address);
