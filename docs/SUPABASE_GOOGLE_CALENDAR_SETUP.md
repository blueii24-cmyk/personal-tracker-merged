# Supabase + optional Google Calendar: consolidated release runbook

This runbook matches the repository's **current local-first Supabase sync implementation** and its AES-GCM-encrypted Google refresh-token storage. It supplements [SUPABASE_SETUP.md](./SUPABASE_SETUP.md) and [GOOGLE_CALENDAR_SETUP.md](./GOOGLE_CALENDAR_SETUP.md); it does not replace them with another schema or backend.

Completing these dashboard steps is separate from verifying a hosted project. Do not claim that authentication, cloud sync, Google Calendar, or an APK works until the corresponding checks below have actually passed.

## 1. Verified implementation map

| Area | Current implementation |
| --- | --- |
| Local/offline data | `SyncedTrackerService` always writes the on-device database first; it behaves like the local mock when Supabase is absent or the user is signed out. |
| Cloud sync | `src/tracker/sync/` implements queued writes, incremental pulls, revision checks, tombstones, conflict review, and guest-to-account merge. |
| Browser Supabase client | `src/tracker/lib/supabase/client.ts` uses PKCE, persistent sessions, and automatic token refresh. Only the project URL and publishable key reach the client. |
| Schema | `supabase/migrations/20261101000000_tracker_sync.sql` is the authoritative migration. Do not add a second tracker schema with different table names. |
| SQL checks | `scripts/test-rls.mjs` applies the migration twice to a scratch plain-Postgres database and checks RLS, revision guards, constraints, deduplication, and private Google tables. It uses Supabase auth/role stand-ins; it is not a live Supabase test. |
| Calendar | App events and preferences sync through Supabase. Optional Google access is implemented by `supabase/functions/google-calendar/`. |
| Google secrets | The Edge Function encrypts the refresh token with `GOOGLE_TOKEN_ENC_KEY`. The browser/APK receives status and calendar metadata, never Google tokens. This implementation does **not** use Supabase Vault. |
| Android | The Capacitor app keeps application ID `com.blueii24.personaltracker`; `scripts/android.mjs` builds the static web bundle, syncs Capacitor, and runs Gradle. |
| Hosting health | `/api/health` belongs to the optional hosting-template Drizzle database, not tracker sync. Missing `DATABASE_URL` returns 503 without breaking the production build. |

## 2. Credentials: where each value belongs

| Value | Where it belongs | Exposure rule |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | Local web env, Vercel, and GitHub Actions repository variables used by the Android build | Public project identifier; still use the real Personal Tracker project, not an arbitrary accessible project. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Same public-client build environments | Public by design; RLS is the data boundary. A legacy anon key is equivalent only if that is what the project supplies. |
| `NEXT_PUBLIC_AUTH_REDIRECT_URL` | Optional web build setting | Public web origin used for email confirmation/password recovery. Do not substitute the Supabase callback or an invented Android scheme. |
| Supabase secret/service-role key | Only trusted server infrastructure; the hosted Edge Function receives platform-provided server credentials | Never in `NEXT_PUBLIC_*`, the APK, Git, logs, screenshots, or chat. It bypasses RLS. |
| `GOOGLE_CLIENT_ID` | Supabase Edge Function secret/configuration | OAuth client identifier; not required by the browser/APK in this architecture. |
| `GOOGLE_CLIENT_SECRET` | Supabase Edge Function secrets only | Never ship or reveal it. |
| `GOOGLE_TOKEN_ENC_KEY` | Supabase Edge Function secrets only | Base64-encoded 32 random bytes. Back it up securely; losing it means users must reconnect Google. |
| `APP_ALLOWED_ORIGINS` | Supabase Edge Function configuration | Comma-separated HTTPS web origins. Put the primary web return origin first. |
| Google refresh/access tokens | Created and used only by the Edge Function | Never place them in localStorage, client tables, Vercel public envs, the APK, logs, or chat. |
| AI provider keys | Existing local/Keystore-backed BYOK storage | Never migrate or synchronize them with tracker records. |

Official references: [Supabase API keys](https://supabase.com/docs/guides/getting-started/api-keys), [Edge Function secrets](https://supabase.com/docs/guides/functions/secrets), [Google OAuth for web-server applications](https://developers.google.com/identity/protocols/oauth2/web-server), and [OAuth security best practices](https://developers.google.com/identity/protocols/oauth2/resources/best-practices).

## 3. Ordered Supabase setup

### A. Establish the project identity before changing anything

1. In the Supabase dashboard, record the intended project's name and non-secret project reference.
2. Compare its Project URL with the URL configured in local development, Vercel, and the GitHub repository variables used for Android. They must all identify the same intended Personal Tracker backend unless an environment is deliberately isolated.
3. Inspect the existing tables, migration history, authentication users, and recent backups before applying SQL. Accessibility alone does not prove that a project belongs to this app.
4. Do not create a replacement project or run a migration against an unrelated project. If the project identity cannot be established, stop hosted changes and continue only with local tests.

### B. Protect existing data

- Use Supabase's available backup/restore facilities and keep an independent logical backup where appropriate: [Supabase backups](https://supabase.com/docs/guides/platform/backups).
- Export the app's local data before an Android reinstall or a destructive local test. The current export format is not a complete Google/OAuth backup; Google copies are intentionally re-synced.
- Never test migration or merge behavior against the only copy of real user data. Use scratch accounts and representative non-sensitive records first.
- Do not run seed/reset commands against production.

### C. Apply the one authoritative migration

Use the supported CLI migration workflow from the repository root:

```bash
npx supabase@2.122.0 login
npx supabase@2.122.0 link --project-ref <PERSONAL_TRACKER_PROJECT_REF>
npx supabase@2.122.0 db push --dry-run
npx supabase@2.122.0 db push
```

Review the dry run before the final command. The migration is `supabase/migrations/20261101000000_tracker_sync.sql`; do not paste a second experimental tracker migration after it. CLI references: [local development workflows](https://supabase.com/docs/guides/local-development/cli-workflows) and [database migrations](https://supabase.com/docs/guides/deployment/database-migrations).

### D. Configure email authentication and redirects

1. Enable Email auth. For a public production app, keep email confirmation enabled unless there is a documented reason and compensating control.
2. In **Authentication → URL Configuration**, set the primary Site URL and allow-list the exact app URLs used for confirmation and recovery.
3. Configure the production web URL separately from local development URLs. Do not use wildcards as a substitute for listing known environments.
4. `NEXT_PUBLIC_AUTH_REDIRECT_URL` is the Supabase-to-app return page. It is **not** Google's OAuth callback and is not a Google-issued value.
5. The current Android flow does not register an auth deep link. Password recovery finishes in the browser, after which the user signs in inside the app. Do not add an intent filter or custom scheme unless that flow is deliberately implemented and tested.

Official references: [Supabase redirect URLs](https://supabase.com/docs/guides/auth/redirect-urls) and [email configuration](https://supabase.com/docs/guides/auth/general-configuration).

## 4. Configure local, Vercel, and Android builds

Use placeholders like those in `.env.example`; enter real values only in the appropriate local/dashboard settings:

```dotenv
NEXT_PUBLIC_SUPABASE_URL=https://<PERSONAL_TRACKER_PROJECT_REF>.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=<PUBLISHABLE_KEY>
# Optional fixed web return origin:
# NEXT_PUBLIC_AUTH_REDIRECT_URL=https://<YOUR_WEB_ORIGIN>
```

- **Local web:** use `.env.local`, then restart/rebuild. Next.js inlines `NEXT_PUBLIC_*` values at build time.
- **Vercel:** configure the existing Personal Tracker project for Production and, where needed, Preview. Redeploy after changing build-time values. Do not create or substitute an unrelated Vercel project.
- **Android/GitHub Actions:** the workflow reads repository **variables** named `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and optionally `NEXT_PUBLIC_AUTH_REDIRECT_URL`. Rebuild the APK after changing them; an already-built APK retains its old inlined configuration.
- **No frontend service key:** neither Vercel nor Android needs a Supabase secret/service-role key for the current tracker implementation.
- **`DATABASE_URL`:** optional for the hosting template's `/api/health` only. Its absence is not a Supabase-sync configuration error.

Vercel reference: [environment variables](https://vercel.com/docs/environment-variables).

## 5. Verify SQL and RLS before relying on cloud sync

Run the repository checks first:

```bash
npm ci
npm run typecheck
npm run lint
npx vitest run
npm run build
```

For the SQL suite, use a **scratch local Postgres administrator connection**. The script creates and forcibly drops a uniquely named test database. Never point it at production:

```bash
# Default local administrator URL: postgresql://postgres:postgres@127.0.0.1:5432/postgres
# Override locally only when your scratch Postgres needs a different URL:
RLS_TEST_ADMIN_URL='<LOCAL_SCRATCH_POSTGRES_ADMIN_URL>' node scripts/test-rls.mjs
```

Require `RLS/migration checks: 60 passed, 0 failed`. The suite verifies, among other things:

- user A cannot read, update, or delete user B's records;
- signed-out callers cannot read private tables or call the meal RPC;
- identical record IDs under different users do not collide;
- stale `base_rev` writes fail instead of overwriting newer cloud data;
- tombstones remain available for synchronization;
- unknown nutrition remains `NULL`, money remains positive integer paise plus transaction type, and constraints reject invalid data;
- chat retries and Google event copies are deduplicated;
- ordinary clients cannot read or write Google credential/OAuth-state tables;
- the token-free Google status function exposes only the caller's own status;
- meal-plus-item writes are atomic.

Then repeat a smaller test with two real Supabase test users on the intended project. SQL stand-ins do not verify hosted Auth, API keys, network behavior, or dashboard configuration. Official references: [Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security) and [RLS testing](https://supabase.com/docs/guides/database/testing-row-level-security).

## 6. Data-preservation and offline-sync acceptance checks

The implemented behavior that must remain intact:

- Local writes succeed offline and remain queued across restarts.
- Sync retries on launch/resume, reconnect, explicit sync, and the in-app interval.
- First-login guest migration is **merge, never replace**: preview first, keep cloud-only and guest records, deduplicate stable IDs, and leave the guest copy intact.
- Sample (`demo-*`) records are excluded unless the user explicitly includes them.
- A safety copy is created before guest merge. Do not describe the ordinary export as a chat-inclusive or OAuth backup.
- Revision checks reject stale writes. Conflicting versions are available for review rather than being silently erased.
- AI keys and Google OAuth tokens are never part of tracker synchronization.

Test with two non-production accounts/devices:

1. Create different local records in A and B; confirm no cross-account rows appear.
2. Create local guest records, sign in, inspect the merge preview, test both sample-data choices, and repeat the merge to check idempotency.
3. Edit the same record on two devices while offline; reconnect both and verify the revision/conflict path and visible review entry.
4. Disable the network during a push, retry, and confirm no duplicates.
5. Delete offline, reconnect, and confirm the tombstone synchronizes without resurrecting the row.
6. Terminate/reopen the app and confirm pending changes and local records survive.
7. Confirm meal items, chats, settings, calendar preferences, and app-created calendar events—not only transactions—survive the scenarios above.

The automated sync tests cover the engine and merge logic; only real device/hosted testing can establish browser WebView, Auth, network, and production-data behavior.

## 7. Ordered Google Cloud + Edge Function setup

Google Calendar is optional and separate from Supabase sign-in. The in-app calendar does not require Google credentials.

### A. Google Cloud

1. Select the intended Google Cloud project and enable **Google Calendar API**.
2. Configure OAuth consent. While External/Testing, add the intended Google test accounts. Confirm Google's current verification/publishing requirements for the requested sensitive scopes before release.
3. Create a **Web application** OAuth client. An Android OAuth client, package fingerprint, and Android deep link are not required by the current server-callback design.
4. Register exactly:

```text
https://<PERSONAL_TRACKER_PROJECT_REF>.supabase.co/functions/v1/google-calendar/callback
```

This is Google-to-Edge-Function. It is distinct from the Supabase auth redirect and from the function's post-consent return to the web app.

The implementation requests:

- `https://www.googleapis.com/auth/calendar.calendarlist.readonly`
- `https://www.googleapis.com/auth/calendar.events.readonly`
- `https://www.googleapis.com/auth/calendar.events.owned` only when the user opts into pushing app events

Do not broaden these to full-calendar access without a separately justified feature. External Testing refresh tokens can expire after seven days; revocation/expiration must lead to the existing reconnect flow. Official references: [configure OAuth consent](https://developers.google.com/workspace/guides/configure-oauth-consent), [create credentials](https://developers.google.com/workspace/guides/create-credentials), [Calendar authorization](https://developers.google.com/workspace/calendar/api/auth), and [incremental synchronization](https://developers.google.com/workspace/calendar/api/guides/sync).

### B. Supabase Edge Function

Use `supabase/functions/.env.example` as the placeholder reference. For hosted deployment, enter these as Supabase Edge Function secrets/configuration, never as `NEXT_PUBLIC_*` values:

```dotenv
GOOGLE_CLIENT_ID=<GOOGLE_WEB_OAUTH_CLIENT_ID>
GOOGLE_CLIENT_SECRET=<GOOGLE_WEB_OAUTH_CLIENT_SECRET>
GOOGLE_TOKEN_ENC_KEY=<BASE64_ENCODED_32_RANDOM_BYTES>
APP_ALLOWED_ORIGINS=https://<PRIMARY_WEB_ORIGIN>,https://<OTHER_ALLOWED_WEB_ORIGIN>
```

The primary web origin must be first because the callback uses it for the post-consent `/calendar` return. The Android WebView origin `https://localhost` is allowed for function calls by the code; it is not the Google redirect URI.

Deploy only the intended function after linking the correct project:

```bash
npx supabase@2.122.0 functions deploy google-calendar --no-verify-jwt
```

`--no-verify-jwt` is required because Google's GET callback has no Supabase JWT. The function itself authenticates every non-callback request with the caller's Supabase JWT. Keep this setting scoped to `google-calendar`; do not disable authentication on other functions.

### C. Verify actual behavior and limits

With a Google test user, verify connect, callback return, calendar selection, incremental sync, token refresh, revocation/reconnect, a 410 full resync, duplicate prevention, offline failure, and reconnect recovery.

The current integration is intentionally not unrestricted bidirectional editing:

- Google events become read-only app copies.
- App-created events can be created/updated in Google only after explicit opt-in and write consent.
- The app never deletes events in Google Calendar; deleting app events, changing calendars, or disconnecting affects the app's own copies/connection only.

Do not label these limitations as full two-way Google Calendar editing.

## 8. Android and Vercel release checks

### Android

```bash
npm ci
node scripts/android.mjs debug
test -s android/app/build/outputs/apk/debug/app-debug.apk
```

Use Node 22, JDK 21, Android platform 36, and build-tools 36.0.0. Keep `com.blueii24.personaltracker` unchanged. Use a debug APK for initial testing; do not create production signing credentials without explicit authorization. For CI, require a successful `Build Android APK` run and a present, downloadable `Personal-Tracker-Debug-APK` artifact—not merely a log saying the build started.

Export local data before installing an APK signed by a different key or uninstalling the app; those operations can make existing app data inaccessible.

### Vercel

1. Deploy only the existing Personal Tracker Vercel project after local checks pass.
2. Confirm the deployment has the intended Supabase public envs and the latest commit.
3. Open the production app, exercise client navigation, sign-in/session persistence, offline reload, and sync with test accounts.
4. Check runtime logs without recording tokens or personal record contents.
5. Interpret `/api/health` correctly: 503 `database: not_configured` is expected when the optional template `DATABASE_URL` is absent; it does not test Supabase or prove tracker sync health.

## 9. Final never-share / handoff checklist

- [ ] Correct Supabase project identity established without exposing credentials.
- [ ] Existing data backed up before hosted schema work.
- [ ] Only `20261101000000_tracker_sync.sql` applied as the tracker schema.
- [ ] Local typecheck, lint, unit tests, production build, and 58 SQL checks passed.
- [ ] Two real users and signed-out access tested on the intended Supabase project.
- [ ] Merge preview, sample choice, retries, duplicates, conflicts, offline edits, and reconnects tested.
- [ ] Vercel and Android rebuilt with the same intended public Supabase configuration.
- [ ] Google Web OAuth callback exactly matches the Edge Function URL.
- [ ] Google secret, token-encryption key, service-role/secret keys, refresh tokens, passwords, and AI keys were never pasted into chat, Git, logs, or `NEXT_PUBLIC_*`.
- [ ] Debug APK exists, is non-empty, installs on a test device, and is available as a downloadable Actions artifact.
- [ ] Any unrun hosted, real-Google, physical-device, or production-data check is reported as unverified.
