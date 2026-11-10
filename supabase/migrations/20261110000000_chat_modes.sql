-- Additive: legacy conversations remain log sessions. No messages or records are changed.
alter table public.chat_sessions
  add column if not exists chat_mode text not null default 'log';
do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'chat_sessions_mode_check' and conrelid = 'public.chat_sessions'::regclass) then
    alter table public.chat_sessions add constraint chat_sessions_mode_check check (chat_mode in ('log', 'casual'));
  end if;
end $$;
