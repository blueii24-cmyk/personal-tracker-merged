-- Personal Tracker: cloud copy of the on-device records, with two-way sync support.
--
-- Design notes
--  * Ids are TEXT because existing records use UUIDs, `demo-*` ids and legacy `id-*` ids. They are preserved as-is.
--  * Every row belongs to one user (`user_id`) and the primary key is (user_id, id), so two users can never collide.
--  * `updated_at` is the CLIENT change clock used by the conflict policy. `rev` is the server revision.
--    A client must send `base_rev` = the revision it last saw (0 for a new row). The guard trigger rejects a write whose
--    base_rev is not the current rev (SQLSTATE 40001), so an older offline copy can never silently overwrite a newer one.
--  * Deletes are tombstones (`deleted_at`) so deletions sync to other devices.
--  * Money is stored as integer paise; nutrition values are nullable (NULL = unknown, never zero).
--  * Row Level Security is enabled on every table. There is NO anon access and no "all users" policy.
--  * Google tokens live in tables with RLS enabled and NO policies, and no grants to anon/authenticated: only the
--    service role (Edge Functions) can read them.

create or replace function public.pt_sync_guard() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.rev := 1;
    new.created_at := now();
    new.server_updated_at := now();
    return new;
  end if;
  if new.base_rev is distinct from old.rev then
    raise exception 'rev_conflict' using errcode = '40001', detail = old.rev::text;
  end if;
  new.rev := old.rev + 1;
  new.user_id := old.user_id;
  new.created_at := old.created_at;
  new.server_updated_at := now();
  return new;
end $$;

-- Shared sync columns (repeated per table; Postgres has no column mixins).
-- user_id, updated_at, deleted_at, rev, base_rev, created_at, server_updated_at

create table if not exists public.meals (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 100),
  meal_type text not null check (meal_type in ('breakfast','lunch','dinner','snack','other')),
  eaten_at timestamptz not null,
  notes text check (notes is null or length(notes) <= 2000),
  source text not null default 'manual' check (source in ('manual','ai')),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 1,
  base_rev bigint not null default 0,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.food_items (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 120),
  meal_id text not null,
  position int not null default 0,
  food_name text not null check (length(btrim(food_name)) between 1 and 200),
  quantity numeric check (quantity is null or (quantity >= 0 and quantity <= 1000000)),
  unit text,
  calories_kcal numeric check (calories_kcal is null or (calories_kcal >= 0 and calories_kcal <= 100000)),
  protein_g numeric check (protein_g is null or (protein_g >= 0 and protein_g <= 10000)),
  is_estimate boolean not null default false,
  nutrition_source text not null default 'unknown' check (nutrition_source in ('ai_estimate','label','verified_database','user_entered','unknown')),
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  foreign key (user_id, meal_id) references public.meals(user_id, id) on delete cascade
);

create table if not exists public.transactions (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 100),
  type text not null check (type in ('income','expense')),
  amount_paise bigint not null check (amount_paise > 0 and amount_paise <= 10000000000),
  currency text not null default 'INR' check (currency = 'INR'),
  category text not null,
  description text not null check (length(btrim(description)) >= 1),
  merchant text,
  notes text,
  occurred_at timestamptz not null,
  source text not null default 'manual' check (source in ('manual','ai')),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 1,
  base_rev bigint not null default 0,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.weigh_ins (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 100),
  weight_kg numeric not null check (weight_kg >= 1 and weight_kg <= 1000),
  recorded_at timestamptz not null,
  notes text,
  source text not null default 'manual' check (source in ('manual','ai')),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 1,
  base_rev bigint not null default 0,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- One row per user. `id` is always 'settings' so the generic sync code can treat it like any other record.
create table if not exists public.user_settings (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null default 'settings' check (id = 'settings'),
  display_name text not null default '' check (length(display_name) <= 60),
  email text not null default '',
  timezone text not null default 'Asia/Kolkata',
  opening_balance_paise bigint not null default 0,
  daily_calorie_target numeric check (daily_calorie_target is null or (daily_calorie_target >= 0 and daily_calorie_target <= 100000)),
  daily_protein_target_g numeric check (daily_protein_target_g is null or (daily_protein_target_g >= 0 and daily_protein_target_g <= 10000)),
  monthly_budget_paise bigint check (monthly_budget_paise is null or monthly_budget_paise >= 0),
  target_weight_kg numeric check (target_weight_kg is null or (target_weight_kg >= 0 and target_weight_kg <= 1000)),
  weight_unit text not null default 'kg' check (weight_unit in ('kg','lb')),
  -- Which provider/model is preferred. NEVER an API key: keys are not synced.
  preferred_ai_provider text not null default 'demo',
  preferred_ai_model text,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 1,
  base_rev bigint not null default 0,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.chat_sessions (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 100),
  title text not null check (length(title) <= 300),
  chat_created_at timestamptz not null,
  chat_updated_at timestamptz not null,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 1,
  base_rev bigint not null default 0,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

create table if not exists public.chat_messages (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 100),
  session_id text not null,
  role text not null check (role in ('user','assistant')),
  content text not null check (length(content) <= 20000),
  message_created_at timestamptz not null,
  -- Idempotency key for a chat turn: a retried submit can never create a second copy.
  client_message_id text,
  extra jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 1,
  base_rev bigint not null default 0,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);
create unique index if not exists chat_messages_client_message_uq on public.chat_messages (user_id, client_message_id) where client_message_id is not null;

create table if not exists public.calendar_events (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null check (length(id) between 1 and 200),
  title text not null check (length(btrim(title)) between 1 and 200),
  notes text check (notes is null or length(notes) <= 4000),
  location text check (location is null or length(location) <= 300),
  all_day boolean not null default false,
  start_date date not null,
  end_date date not null,
  starts_at timestamptz,
  ends_at timestamptz,
  category text not null default 'personal',
  origin text not null default 'app' check (origin in ('app','google')),
  google_calendar_id text,
  google_event_id text,
  google_etag text,
  read_only boolean not null default false,
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 1,
  base_rev bigint not null default 0,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id),
  check (end_date >= start_date)
);
-- A Google event can exist once per user and calendar: no duplicate copies after repeated syncs.
create unique index if not exists calendar_events_google_uq on public.calendar_events (user_id, google_calendar_id, google_event_id) where google_event_id is not null and deleted_at is null;

create table if not exists public.calendar_preferences (
  user_id uuid not null default auth.uid() references auth.users(id) on delete cascade,
  id text not null default 'prefs' check (id = 'prefs'),
  week_start smallint not null default 1 check (week_start in (0,1,6)),
  default_view text not null default 'month' check (default_view in ('month','agenda')),
  visible jsonb not null default '{}'::jsonb,
  accent text not null default 'primary',
  updated_at timestamptz not null default now(),
  deleted_at timestamptz,
  rev bigint not null default 1,
  base_rev bigint not null default 0,
  created_at timestamptz not null default now(),
  server_updated_at timestamptz not null default now(),
  primary key (user_id, id)
);

-- Indexes for the incremental pull (`server_updated_at >= cursor`) and for date lookups.
create index if not exists meals_pull_idx on public.meals (user_id, server_updated_at);
create index if not exists food_items_meal_idx on public.food_items (user_id, meal_id);
create index if not exists food_items_pull_idx on public.food_items (user_id, server_updated_at);
create index if not exists transactions_pull_idx on public.transactions (user_id, server_updated_at);
create index if not exists weigh_ins_pull_idx on public.weigh_ins (user_id, server_updated_at);
create index if not exists user_settings_pull_idx on public.user_settings (user_id, server_updated_at);
create index if not exists chat_sessions_pull_idx on public.chat_sessions (user_id, server_updated_at);
create index if not exists chat_messages_pull_idx on public.chat_messages (user_id, server_updated_at);
create index if not exists chat_messages_session_idx on public.chat_messages (user_id, session_id);
create index if not exists calendar_events_pull_idx on public.calendar_events (user_id, server_updated_at);
create index if not exists calendar_events_date_idx on public.calendar_events (user_id, start_date);
create index if not exists calendar_preferences_pull_idx on public.calendar_preferences (user_id, server_updated_at);

-- Guard triggers (revision check + server timestamps).
do $$
declare t text;
begin
  foreach t in array array['meals','transactions','weigh_ins','user_settings','chat_sessions','chat_messages','calendar_events','calendar_preferences']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_guard', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.pt_sync_guard()', t || '_guard', t);
  end loop;
end $$;

create or replace function public.pt_touch_item() returns trigger
language plpgsql security invoker set search_path = public as $$
begin
  new.server_updated_at := now();
  return new;
end $$;
drop trigger if exists food_items_touch on public.food_items;
create trigger food_items_touch before insert or update on public.food_items for each row execute function public.pt_touch_item();

-- Atomic meal + items write. Runs as the caller (SECURITY INVOKER) so RLS applies to every statement.
create or replace function public.pt_upsert_meal(p jsonb) returns bigint
language plpgsql security invoker set search_path = public as $$
declare
  v_uid uuid := auth.uid();
  v_id text := p->>'id';
  v_rev bigint;
begin
  if v_uid is null then
    raise exception 'not_authenticated' using errcode = '28000';
  end if;
  insert into public.meals (user_id, id, meal_type, eaten_at, notes, source, updated_at, deleted_at, base_rev)
  values (v_uid, v_id, p->>'meal_type', (p->>'eaten_at')::timestamptz, p->>'notes', coalesce(p->>'source','manual'),
          (p->>'updated_at')::timestamptz, nullif(p->>'deleted_at','')::timestamptz, coalesce((p->>'base_rev')::bigint, 0))
  on conflict (user_id, id) do update set
    meal_type = excluded.meal_type, eaten_at = excluded.eaten_at, notes = excluded.notes, source = excluded.source,
    updated_at = excluded.updated_at, deleted_at = excluded.deleted_at, base_rev = excluded.base_rev
  returning rev into v_rev;

  delete from public.food_items where user_id = v_uid and meal_id = v_id;
  if nullif(p->>'deleted_at','') is null then
    insert into public.food_items (user_id, id, meal_id, position, food_name, quantity, unit, calories_kcal, protein_g, is_estimate, nutrition_source)
    select v_uid, it->>'id', v_id, (pos - 1)::int, it->>'food_name', (it->>'quantity')::numeric, it->>'unit',
           (it->>'calories_kcal')::numeric, (it->>'protein_g')::numeric, coalesce((it->>'is_estimate')::boolean, false),
           coalesce(it->>'nutrition_source', 'unknown')
    from jsonb_array_elements(coalesce(p->'items', '[]'::jsonb)) with ordinality as t(it, pos);
  end if;
  return v_rev;
end $$;

-- ------------------------------ Row Level Security ------------------------------
do $$
declare t text;
begin
  foreach t in array array['meals','food_items','transactions','weigh_ins','user_settings','chat_sessions','chat_messages','calendar_events','calendar_preferences']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('alter table public.%I force row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
    execute format('drop policy if exists %I on public.%I', t || '_select_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_insert_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_update_own', t);
    execute format('drop policy if exists %I on public.%I', t || '_delete_own', t);
    execute format('create policy %I on public.%I for select to authenticated using (user_id = (select auth.uid()))', t || '_select_own', t);
    execute format('create policy %I on public.%I for insert to authenticated with check (user_id = (select auth.uid()))', t || '_insert_own', t);
    execute format('create policy %I on public.%I for update to authenticated using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()))', t || '_update_own', t);
    execute format('create policy %I on public.%I for delete to authenticated using (user_id = (select auth.uid()))', t || '_delete_own', t);
  end loop;
end $$;

revoke all on function public.pt_upsert_meal(jsonb) from anon, public;
grant execute on function public.pt_upsert_meal(jsonb) to authenticated;

-- ------------------------- Google Calendar (server-only) -------------------------
-- Refresh tokens are stored encrypted by the Edge Function (AES-GCM, key from a function secret).
-- RLS is enabled with NO policies and all client grants are revoked: ordinary clients can neither read nor write these rows.
create table if not exists public.google_calendar_connections (
  user_id uuid primary key references auth.users(id) on delete cascade,
  encrypted_refresh_token text not null,
  scope text not null,
  google_email text,
  selected_calendar_id text,
  selected_calendar_name text,
  sync_token text,
  push_app_events boolean not null default false,
  status text not null default 'connected' check (status in ('connected','needs_reconsent','error')),
  last_synced_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table if not exists public.google_oauth_states (
  state_hash text primary key,
  user_id uuid not null references auth.users(id) on delete cascade,
  code_verifier text not null,
  return_to text not null default 'web',
  expires_at timestamptz not null
);
create index if not exists google_oauth_states_exp_idx on public.google_oauth_states (expires_at);
alter table public.google_calendar_connections enable row level security;
alter table public.google_calendar_connections force row level security;
alter table public.google_oauth_states enable row level security;
alter table public.google_oauth_states force row level security;
revoke all on public.google_calendar_connections from anon, authenticated, public;
revoke all on public.google_oauth_states from anon, authenticated, public;

-- Safe, token-free view of the connection for the signed-in user (no secrets; security_invoker so RLS-style filtering is explicit).
create or replace function public.pt_google_status() returns table (connected boolean, status text, google_email text, selected_calendar_id text, selected_calendar_name text, push_app_events boolean, last_synced_at timestamptz, last_error text)
language sql security definer set search_path = public as $$
  select true, c.status, c.google_email, c.selected_calendar_id, c.selected_calendar_name, c.push_app_events, c.last_synced_at, c.last_error
  from public.google_calendar_connections c where c.user_id = auth.uid()
$$;
revoke all on function public.pt_google_status() from anon, public;
grant execute on function public.pt_google_status() to authenticated;
