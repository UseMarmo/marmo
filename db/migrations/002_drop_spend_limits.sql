alter table marmo_wallets
  drop column if exists daily_limit_usd,
  drop column if exists spent_today_usd,
  drop column if exists spent_date;
