-- Additive only. Existing users remain unset; water intake itself is represented by
-- ordinary Water food items and uses the existing RLS-protected meal RPC unchanged.
alter table public.user_settings
  add column if not exists daily_water_target_ml numeric
  check (daily_water_target_ml is null or (daily_water_target_ml > 0 and daily_water_target_ml <= 100000));
