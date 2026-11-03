-- Authenticated default-AI usage reservations. No prompts, responses, keys, or provider payloads are stored.
-- Only the service role may read/write these tables or execute these functions.

create table if not exists public.ai_rate_limits (
  user_id uuid not null references auth.users(id) on delete cascade,
  window_start timestamptz not null,
  requests bigint not null check (requests >= 0),
  primary key (user_id, window_start)
);

create table if not exists public.ai_user_usage_daily (
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  requests bigint not null default 0 check (requests >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  updated_at timestamptz not null default now(),
  primary key (user_id, day)
);

create table if not exists public.ai_global_usage_daily (
  day date primary key,
  requests bigint not null default 0 check (requests >= 0),
  input_tokens bigint not null default 0 check (input_tokens >= 0),
  output_tokens bigint not null default 0 check (output_tokens >= 0),
  cost_micros bigint not null default 0 check (cost_micros >= 0),
  updated_at timestamptz not null default now()
);

create table if not exists public.ai_usage_reservations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  day date not null,
  input_tokens bigint not null check (input_tokens >= 0),
  output_tokens bigint not null check (output_tokens >= 0),
  cost_micros bigint not null check (cost_micros >= 0),
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
create index if not exists ai_usage_reservations_open_idx on public.ai_usage_reservations (user_id, created_at) where settled_at is null;

-- One transaction reserves the per-minute, per-user daily, and global daily budgets.
-- Any limit failure rolls back every counter and the reservation, so a rejected call cannot consume quota.
create or replace function public.pt_ai_reserve(
  p_user_id uuid,
  p_day date,
  p_input_tokens bigint,
  p_output_tokens bigint,
  p_cost_micros bigint,
  p_rate_limit bigint,
  p_user_request_limit bigint,
  p_user_token_limit bigint,
  p_global_request_limit bigint,
  p_global_token_limit bigint,
  p_spend_cap_micros bigint
) returns uuid
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  v_requests bigint;
  v_tokens bigint;
  v_cost bigint;
  v_id uuid;
begin
  if p_user_id is null or p_input_tokens < 0 or p_output_tokens < 0 or p_cost_micros < 0 then
    raise exception 'invalid_usage_reservation';
  end if;

  insert into public.ai_rate_limits (user_id, window_start, requests)
  values (p_user_id, date_trunc('minute', now()), 1)
  on conflict (user_id, window_start) do update set requests = public.ai_rate_limits.requests + 1
  returning requests into v_requests;
  if v_requests > p_rate_limit then
    raise exception 'rate_limited';
  end if;

  insert into public.ai_global_usage_daily (day, requests, input_tokens, output_tokens, cost_micros)
  values (p_day, 1, p_input_tokens, p_output_tokens, p_cost_micros)
  on conflict (day) do update set
    requests = public.ai_global_usage_daily.requests + 1,
    input_tokens = public.ai_global_usage_daily.input_tokens + p_input_tokens,
    output_tokens = public.ai_global_usage_daily.output_tokens + p_output_tokens,
    cost_micros = public.ai_global_usage_daily.cost_micros + p_cost_micros,
    updated_at = now()
  returning requests, input_tokens + output_tokens, cost_micros into v_requests, v_tokens, v_cost;
  if v_requests > p_global_request_limit or v_tokens > p_global_token_limit or (p_spend_cap_micros > 0 and v_cost > p_spend_cap_micros) then
    raise exception 'global_quota_exceeded';
  end if;

  insert into public.ai_user_usage_daily (day, user_id, requests, input_tokens, output_tokens, cost_micros)
  values (p_day, p_user_id, 1, p_input_tokens, p_output_tokens, p_cost_micros)
  on conflict (user_id, day) do update set
    requests = public.ai_user_usage_daily.requests + 1,
    input_tokens = public.ai_user_usage_daily.input_tokens + p_input_tokens,
    output_tokens = public.ai_user_usage_daily.output_tokens + p_output_tokens,
    cost_micros = public.ai_user_usage_daily.cost_micros + p_cost_micros,
    updated_at = now()
  returning requests, input_tokens + output_tokens into v_requests, v_tokens;
  if v_requests > p_user_request_limit or v_tokens > p_user_token_limit then
    raise exception 'user_quota_exceeded';
  end if;

  insert into public.ai_usage_reservations (user_id, day, input_tokens, output_tokens, cost_micros)
  values (p_user_id, p_day, p_input_tokens, p_output_tokens, p_cost_micros)
  returning id into v_id;
  return v_id;
end;
$$;

-- Replace a conservative reservation with actual usage. Requests still count on provider failures;
-- token/cost reservations are released. Repeated settlement is a no-op.
create or replace function public.pt_ai_settle(
  p_reservation_id uuid,
  p_actual_input_tokens bigint,
  p_actual_output_tokens bigint,
  p_actual_cost_micros bigint
) returns void
language plpgsql security definer set search_path = public, pg_temp as $$
declare
  r public.ai_usage_reservations%rowtype;
begin
  if p_actual_input_tokens < 0 or p_actual_output_tokens < 0 or p_actual_cost_micros < 0 then
    raise exception 'invalid_usage_settlement';
  end if;
  select * into r from public.ai_usage_reservations where id = p_reservation_id for update;
  if not found or r.settled_at is not null then
    return;
  end if;

  update public.ai_user_usage_daily set
    input_tokens = greatest(0, input_tokens + p_actual_input_tokens - r.input_tokens),
    output_tokens = greatest(0, output_tokens + p_actual_output_tokens - r.output_tokens),
    cost_micros = greatest(0, cost_micros + p_actual_cost_micros - r.cost_micros),
    updated_at = now()
  where user_id = r.user_id and day = r.day;
  update public.ai_global_usage_daily set
    input_tokens = greatest(0, input_tokens + p_actual_input_tokens - r.input_tokens),
    output_tokens = greatest(0, output_tokens + p_actual_output_tokens - r.output_tokens),
    cost_micros = greatest(0, cost_micros + p_actual_cost_micros - r.cost_micros),
    updated_at = now()
  where day = r.day;
  update public.ai_usage_reservations set settled_at = now() where id = r.id;
end;
$$;

do $$
declare t text;
begin
  foreach t in array array['ai_rate_limits','ai_user_usage_daily','ai_global_usage_daily','ai_usage_reservations']
  loop
    execute format('alter table public.%I enable row level security', t);
    execute format('revoke all on public.%I from anon, authenticated, public', t);
  end loop;
end $$;

revoke all on function public.pt_ai_reserve(uuid,date,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint) from public, anon, authenticated;
revoke all on function public.pt_ai_settle(uuid,bigint,bigint,bigint) from public, anon, authenticated;
grant execute on function public.pt_ai_reserve(uuid,date,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint) to service_role;
grant execute on function public.pt_ai_settle(uuid,bigint,bigint,bigint) to service_role;
