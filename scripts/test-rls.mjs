// Verifies the Supabase migration and RLS against a throw-away PLAIN Postgres database with stand-ins for Supabase's
// `auth` schema and roles. It proves the policies/guards in the SQL; it is NOT a test against a live Supabase project.
// Usage: node scripts/test-rls.mjs   (needs a local Postgres; set RLS_TEST_ADMIN_URL to override)
import fs from 'node:fs';
import pg from 'pg';

const admin = process.env.RLS_TEST_ADMIN_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5432/postgres';
const dbName = `rls_test_${Date.now()}`;
const root = new pg.Client({ connectionString: admin });
await root.connect();
await root.query(`create database ${dbName}`);
const url = new URL(admin);
url.pathname = `/${dbName}`;
const c = new pg.Client({ connectionString: url.toString() });
await c.connect();

let passed = 0;
let failed = 0;
const ok = (name, cond, extra = '') => {
  if (cond) passed++;
  else {
    failed++;
    console.error(`FAIL: ${name} ${extra}`);
  }
};

const A = '11111111-1111-1111-1111-111111111111';
const B = '22222222-2222-2222-2222-222222222222';

try {
  await c.query(`
    do $$ begin
      if not exists (select 1 from pg_roles where rolname='anon') then create role anon nologin; end if;
      if not exists (select 1 from pg_roles where rolname='authenticated') then create role authenticated nologin; end if;
      if not exists (select 1 from pg_roles where rolname='service_role') then create role service_role nologin bypassrls; end if;
    end $$;
    create schema auth;
    create table auth.users (id uuid primary key);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
    grant usage on schema auth to anon, authenticated;
    grant usage on schema public to anon, authenticated;
    -- Supabase grants new public tables to these roles by default; the migration must revoke what clients shouldn't have.
    alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges in schema public grant execute on functions to anon, authenticated, service_role;
    grant all on schema public to service_role;
    insert into auth.users values ('${A}'), ('${B}');
  `);
  await c.query(fs.readFileSync(new URL('../supabase/migrations/20261101000000_tracker_sync.sql', import.meta.url), 'utf8'));
  ok('migration applies', true);
  // Re-applying must be safe (idempotent).
  await c.query(fs.readFileSync(new URL('../supabase/migrations/20261101000000_tracker_sync.sql', import.meta.url), 'utf8'));
  ok('migration is re-runnable', true);

  // Run a callback as a given Supabase-like caller inside a rolled-back-on-error transaction.
  const as = async (role, uid, fn) => {
    await c.query('begin');
    try {
      await c.query(`set local role ${role}`);
      await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
      return await fn();
    } finally {
      await c.query('commit').catch(() => c.query('rollback'));
    }
  };
  const tryQ = async (role, uid, sql, params = []) => {
    await c.query('begin');
    try {
      await c.query(`set local role ${role}`);
      await c.query(`select set_config('request.jwt.claim.sub', $1, true)`, [uid ?? '']);
      const r = await c.query(sql, params);
      await c.query('commit');
      return { ok: true, rows: r.rows, rowCount: r.rowCount };
    } catch (e) {
      await c.query('rollback');
      return { ok: false, code: e.code, message: e.message };
    }
  };

  const meal = (id, extra = {}) => ({ id, meal_type: 'lunch', eaten_at: '2026-11-01T06:30:00Z', notes: null, source: 'manual', updated_at: '2026-11-01T07:00:00Z', base_rev: 0, items: [{ id: `${id}-i1`, food_name: 'Rice', quantity: 2, unit: 'cup', calories_kcal: null, protein_g: 4, is_estimate: true, nutrition_source: 'ai_estimate' }], ...extra });

  // --- signed-in owner can write and read their own rows
  let r = await tryQ('authenticated', A, 'select public.pt_upsert_meal($1::jsonb) as rev', [JSON.stringify(meal('m1'))]);
  ok('A can upsert a meal via RPC', r.ok && Number(r.rows[0].rev) === 1, JSON.stringify(r));
  r = await tryQ('authenticated', A, 'select count(*)::int n from meals');
  ok('A sees own meal', r.ok && r.rows[0].n === 1);
  r = await tryQ('authenticated', A, 'select calories_kcal, protein_g from food_items where meal_id=$1', ['m1']);
  ok('unknown calories stay NULL (not zero)', r.ok && r.rows[0].calories_kcal === null && Number(r.rows[0].protein_g) === 4);

  // --- isolation
  r = await tryQ('authenticated', B, 'select count(*)::int n from meals');
  ok('B cannot see A meals', r.ok && r.rows[0].n === 0);
  r = await tryQ('authenticated', B, 'select count(*)::int n from food_items');
  ok('B cannot see A food items', r.ok && r.rows[0].n === 0);
  r = await tryQ('authenticated', B, `update meals set notes='hacked' where id='m1'`);
  ok('B cannot update A meal', r.ok && r.rowCount === 0);
  r = await tryQ('authenticated', B, `delete from meals where id='m1'`);
  ok('B cannot delete A meal', r.ok && r.rowCount === 0);
  r = await tryQ('authenticated', B, `insert into meals (user_id,id,meal_type,eaten_at,updated_at) values ('${A}','evil','lunch',now(),now())`);
  ok('B cannot insert a row owned by A', !r.ok && r.code === '42501', JSON.stringify(r));
  r = await tryQ('authenticated', B, 'select public.pt_upsert_meal($1::jsonb) as rev', [JSON.stringify(meal('m1', { base_rev: 1 }))]);
  ok('B using A meal id creates B\'s own row, never touching A', r.ok);
  r = await tryQ('authenticated', A, `select notes, (select count(*)::int from food_items) as items from meals where id='m1'`);
  ok('A row untouched by B', r.ok && r.rows[0].notes === null && r.rows[0].items === 1);
  r = await tryQ('authenticated', B, `select count(*)::int n from meals`);
  ok('B has exactly its own row', r.rows[0].n === 1);

  // --- signed-out access is denied
  r = await tryQ('anon', null, 'select * from meals');
  ok('anon cannot read meals', !r.ok && r.code === '42501', JSON.stringify(r));
  r = await tryQ('anon', null, 'select public.pt_upsert_meal($1::jsonb)', [JSON.stringify(meal('x'))]);
  ok('anon cannot call the meal RPC', !r.ok && r.code === '42501');
  r = await tryQ('authenticated', '', 'select public.pt_upsert_meal($1::jsonb)', [JSON.stringify(meal('x'))]);
  ok('a token without a user is rejected', !r.ok);
  for (const t of ['transactions', 'weigh_ins', 'user_settings', 'chat_sessions', 'chat_messages', 'calendar_events', 'calendar_preferences', 'food_items']) {
    r = await tryQ('anon', null, `select * from ${t}`);
    ok(`anon cannot read ${t}`, !r.ok && r.code === '42501');
  }

  // --- optimistic concurrency: an older offline copy cannot overwrite a newer cloud record
  const tx = (base) => ({ id: 't1', type: 'expense', amount_paise: 12345, category: 'food', description: 'Lunch', occurred_at: '2026-11-01T06:00:00Z', updated_at: '2026-11-01T07:00:00Z', base_rev: base });
  const up = (row, uid) => tryQ('authenticated', uid, `insert into transactions (id,type,amount_paise,category,description,occurred_at,updated_at,base_rev) values ($1,$2,$3,$4,$5,$6,$7,$8)
    on conflict (user_id,id) do update set type=excluded.type, amount_paise=excluded.amount_paise, category=excluded.category, description=excluded.description, occurred_at=excluded.occurred_at, updated_at=excluded.updated_at, base_rev=excluded.base_rev returning rev`,
    [row.id, row.type, row.amount_paise, row.category, row.description, row.occurred_at, row.updated_at, row.base_rev]);
  r = await up(tx(0), A);
  ok('A creates a transaction (rev 1)', r.ok && Number(r.rows[0].rev) === 1, JSON.stringify(r));
  r = await up({ ...tx(1), amount_paise: 20000 }, A);
  ok('device 1 edits with the current revision (rev 2)', r.ok && Number(r.rows[0].rev) === 2);
  r = await up({ ...tx(1), amount_paise: 99999 }, A);
  ok('device 2 (stale base_rev=1) is rejected with 40001', !r.ok && r.code === '40001', JSON.stringify(r));
  r = await tryQ('authenticated', A, `select amount_paise from transactions where id='t1'`);
  ok('the newer cloud value survived', Number(r.rows[0].amount_paise) === 20000);
  r = await up(tx(0), A);
  ok('re-sending a "new" row that already exists is rejected (client then reconciles)', !r.ok && r.code === '40001');

  // --- tombstones
  r = await tryQ('authenticated', A, `update transactions set deleted_at=now(), base_rev=2 where id='t1' returning rev`);
  ok('soft delete bumps the revision', r.ok && Number(r.rows[0].rev) === 3);
  r = await tryQ('authenticated', A, `select count(*)::int n from transactions where deleted_at is not null`);
  ok('tombstone is readable for sync', r.rows[0].n === 1);

  // --- constraints
  r = await tryQ('authenticated', A, `insert into transactions (id,type,amount_paise,category,description,occurred_at) values ('neg','expense',-5,'food','x',now())`);
  ok('negative amounts rejected', !r.ok && r.code === '23514');
  r = await tryQ('authenticated', A, `insert into weigh_ins (id,weight_kg,recorded_at) values ('w0',0.5,now())`);
  ok('implausible weight rejected', !r.ok && r.code === '23514');
  r = await tryQ('authenticated', A, `insert into user_settings (id) values ('other')`);
  ok('only one settings row id allowed', !r.ok);

  // --- chat idempotency
  const msg = (id) => tryQ('authenticated', A, `insert into chat_messages (id,session_id,role,content,message_created_at,client_message_id) values ($1,'s1','user','hi',now(),'cm-1')`, [id]);
  r = await msg('a1');
  ok('first chat message stored', r.ok);
  r = await msg('a2');
  ok('same clientMessageId cannot be stored twice', !r.ok && r.code === '23505');
  r = await tryQ('authenticated', B, `insert into chat_messages (id,session_id,role,content,message_created_at,client_message_id) values ('b1','s1','user','hi',now(),'cm-1')`);
  ok('another user may reuse the same clientMessageId', r.ok);

  // --- calendar dedupe
  const ev = (id) => tryQ('authenticated', A, `insert into calendar_events (id,title,start_date,end_date,origin,google_calendar_id,google_event_id) values ($1,'Standup','2026-11-02','2026-11-02','google','cal1','gev1')`, [id]);
  r = await ev('e1');
  ok('google event stored', r.ok);
  r = await ev('e2');
  ok('same Google event cannot be stored twice', !r.ok && r.code === '23505');
  r = await tryQ('authenticated', A, `insert into calendar_events (id,title,start_date,end_date) values ('bad','x','2026-11-03','2026-11-02')`);
  ok('event ending before it starts rejected', !r.ok && r.code === '23514');

  // --- Google credentials are inaccessible to ordinary clients
  await c.query(`insert into google_calendar_connections (user_id, encrypted_refresh_token, scope) values ('${A}', 'ciphertext', 'calendar.events')`);
  for (const role of ['authenticated', 'anon']) {
    r = await tryQ(role, A, 'select * from google_calendar_connections');
    ok(`${role} cannot read Google connection rows`, !r.ok && r.code === '42501');
    r = await tryQ(role, A, 'select * from google_oauth_states');
    ok(`${role} cannot read OAuth state rows`, !r.ok && r.code === '42501');
    r = await tryQ(role, A, `update google_calendar_connections set encrypted_refresh_token='x'`);
    ok(`${role} cannot write Google connection rows`, !r.ok && r.code === '42501');
  }
  r = await tryQ('authenticated', A, 'select * from pt_google_status()');
  ok('owner sees a token-free status', r.ok && r.rows[0].connected === true && !('encrypted_refresh_token' in r.rows[0]));
  r = await tryQ('authenticated', B, 'select * from pt_google_status()');
  ok('another user sees no connection', r.ok && r.rows.length === 0);
  r = await c.query(`select has_table_privilege('service_role','google_calendar_connections','select') as s`);
  ok('service role (Edge Functions) keeps access', r.rows[0].s === true);

  // --- no permissive policies anywhere
  r = await c.query(`select tablename, policyname from pg_policies where schemaname='public' and (qual = 'true' or with_check = 'true' or 'public' = any(roles) or 'anon' = any(roles))`);
  ok('no "all users" / anon policies exist', r.rows.length === 0, JSON.stringify(r.rows));
  r = await c.query(`select relname from pg_class c join pg_namespace n on n.oid=c.relnamespace where n.nspname='public' and c.relkind='r' and not c.relrowsecurity`);
  ok('RLS is enabled on every public table', r.rows.length === 0, JSON.stringify(r.rows));

  // --- meal RPC is atomic
  r = await tryQ('authenticated', A, 'select public.pt_upsert_meal($1::jsonb)', [JSON.stringify(meal('m2', { items: [{ id: 'ok', food_name: 'Egg' }, { id: 'bad', food_name: '' }] }))]);
  ok('a meal with an invalid item is rejected', !r.ok);
  r = await tryQ('authenticated', A, `select (select count(*)::int from meals where id='m2') as meals, (select count(*)::int from food_items where meal_id='m2') as items`);
  ok('...and nothing was partially written', r.rows[0].meals === 0 && r.rows[0].items === 0);
  r = await tryQ('authenticated', A, 'select public.pt_upsert_meal($1::jsonb) as rev', [JSON.stringify(meal('m1', { base_rev: 1, notes: 'edited', items: [{ id: 'm1-i9', food_name: 'Dal' }] }))]);
  ok('edit replaces items atomically', r.ok && Number(r.rows[0].rev) === 2);
  r = await tryQ('authenticated', A, `select food_name from food_items where meal_id='m1'`);
  ok('only the new item remains', r.rows.length === 1 && r.rows[0].food_name === 'Dal');
  r = await tryQ('authenticated', A, 'select public.pt_upsert_meal($1::jsonb)', [JSON.stringify(meal('m1', { base_rev: 1, notes: 'stale' }))]);
  ok('stale meal write rejected by the revision guard', !r.ok && r.code === '40001');
  r = await tryQ('authenticated', A, `select notes from meals where id='m1'`);
  ok('...and the newer notes survived', r.rows[0].notes === 'edited');
  r = await tryQ('authenticated', A, `select count(*)::int n from food_items where meal_id='m1'`);
  ok('...and items were not wiped by the rejected write', r.rows[0].n === 1);

  // --- RLS is not a substitute for safe table privileges: TRUNCATE bypasses row policies
  r = await tryQ('authenticated', A, 'truncate public.meals');
  ok('authenticated cannot truncate a table', !r.ok && r.code === '42501', JSON.stringify(r));
  r = await c.query(`select table_name, privilege_type from information_schema.role_table_grants where table_schema='public' and grantee in ('anon','authenticated') and privilege_type in ('TRUNCATE','TRIGGER','REFERENCES')`);
  ok('clients have no TRUNCATE/TRIGGER/REFERENCES table privileges', r.rows.length === 0, JSON.stringify(r.rows));
} finally {
  await c.end();
  await root.query(`drop database ${dbName} with (force)`);
  await root.end();
}
console.log(`RLS/migration checks: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
