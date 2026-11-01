-- Keep owner-only DML, but remove Supabase's default privileged table grants.
-- In particular, TRUNCATE is not protected by row-level security and must never be available to clients.
do $$
declare t text;
begin
  foreach t in array array['meals','food_items','transactions','weigh_ins','user_settings','chat_sessions','chat_messages','calendar_events','calendar_preferences']
  loop
    execute format('revoke all on public.%I from anon, authenticated, public', t);
    execute format('grant select, insert, update, delete on public.%I to authenticated', t);
  end loop;
end $$;
