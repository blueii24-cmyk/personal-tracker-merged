# Supabase setup (optional cloud sync)

The app works without any of this: with no Supabase variables, or while signed out, it is the same local app as before.

## 1. Create the project and apply the schema
1. Create a project at supabase.com. Note the **Project URL** and the **publishable (anon) key** (Project Settings → API).
2. Apply `supabase/migrations/20261101000000_tracker_sync.sql` (SQL editor → paste → run, or `supabase link` then `supabase db push`). It is safe to run twice.
3. Authentication → Providers → **Email** enabled. Decide whether "Confirm email" is on (the app handles both).
4. Authentication → URL Configuration: set **Site URL** to the web page that hosts this app, and add it to **Redirect URLs**.
   Confirmation/reset links open in a browser. On Android, finish a password reset in the browser, then sign in inside the app.
5. Do **not** enable anonymous sign-ins: the policies assume a real signed-in user.

## 2. Configure the app (public values only)
```
NEXT_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT-REF.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=YOUR-PUBLISHABLE-OR-ANON-KEY
```
Put them in `.env.local` (or the hosting dashboard) **before** `npm run build` / `node scripts/android.mjs debug`; they are inlined at build time.
The service-role / secret key must never be put in the app, in `NEXT_PUBLIC_*`, or in Git.

## 3. How data is protected
* Every table has Row Level Security with owner-only policies (`user_id = auth.uid()`), no `anon` grants and no "all users" policy.
* `google_calendar_connections` / `google_oauth_states` have RLS enabled, **no policies** and all client grants revoked; only the service role (Edge Functions) can read them.
* Writes carry the revision they were based on (`base_rev`). A trigger rejects a stale write (SQLSTATE 40001) so an older offline copy can never silently overwrite a newer cloud record; the app then reconciles it (see "Conflict policy").
* Meals and their food items are written in one transaction by `pt_upsert_meal`.
* AI API keys are never synced and have no column anywhere.
* Test it: `node scripts/test-rls.mjs` runs 58 checks (isolation, signed-out denial, revision guard, tombstones, chat idempotency, constraints, Google table lockout, atomic meals) against a throw-away **plain Postgres** database that stands in for Supabase's `auth` schema and roles. It is not a test against your live project: after applying the migration, sign in as two real users and confirm each only sees their own data.

## 4. Sync behaviour
* Local first: every write is saved on the device immediately and queued; the queue survives restarts and is retried on launch, app resume, reconnect, after each change and every minute while the app is open.
* Account cache is partitioned per user on the device (`pt.acct.<userId>.*`); local records from before sign-in stay in the original local partition until you choose to merge them.
* **Conflict policy** (`src/tracker/sync/resolve.ts`): same content → nothing to do; one side deleted and the other edited → the edit wins; both edited → the later change wins (device clock), exact tie → the cloud copy. The version that lost is never discarded: it appears under Settings → Account & sync → *Needs review* with "Use the other version".
* **Merge on first sign-in**: preview of both sides, sample (`demo-*`) records excluded unless you tick the box, a safety copy first (`pt.merge.backup.<userId>.<time>`), same ids are de-duplicated, cloud-only records are kept, the on-device copy is never deleted. Re-running is a no-op.
* Deleting is a tombstone, so it syncs to other devices. "Delete all records" while signed in deletes the account's copies too.

## 5. Trusted server code (Edge Functions only)
See `docs/GOOGLE_CALENDAR_SETUP.md`. No Next.js server routes were added (they would break the static Android export); `/api/health` is unchanged.

## 6. AI relay decision
Direct on-device BYOK calls remain the default. A Supabase Edge Function relay was **not** built: it would send your key and data through this app's backend, and there was no evidence that a provider blocks the app's origin (the app now reports a connection/CORS failure distinctly, with the code `NETWORK_OR_CORS`, so a real block can be diagnosed). If a first-party provider is later proven to block the WebView origin, add an allow-listed relay (OpenAI/Anthropic/Gemini hosts only, JWT-validated, size-limited, rate-limited, no logging of bodies/keys, never stores the key) and disclose it in the AI settings; never relay arbitrary custom endpoints.
