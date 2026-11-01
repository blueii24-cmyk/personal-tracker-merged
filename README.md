# Personal Tracker

Bulking (meals, calories, protein, weight) and budget (₹ income/expenses) tracking with a chat assistant.
A client-side Next.js app, packaged for Android with Capacitor. Records are stored on the device first and work fully
offline. Optionally, sign in to keep a synced cloud copy (Supabase) and connect Google Calendar; both are off until configured.

- Audit, fixes, test results, limitations: [docs/AUDIT.md](docs/AUDIT.md)
- Cloud sync setup (Supabase, SQL, env vars, RLS tests, conflict policy): [docs/SUPABASE_SETUP.md](docs/SUPABASE_SETUP.md)
- Optional Google Calendar setup: [docs/GOOGLE_CALENDAR_SETUP.md](docs/GOOGLE_CALENDAR_SETUP.md)
- Google Play release, signing, Data Safety, privacy policy template: [docs/ANDROID_RELEASE.md](docs/ANDROID_RELEASE.md)

## Web: run and build

```bash
npm ci
npm run dev            # http://localhost:3000
npx vitest run         # unit tests
npx eslint .           # lint
npm run build          # normal server build (also serves /api/health for the hosting preview)
```

`DATABASE_URL` in `.env` is only needed by the `/api/health` route of the hosting template; the tracker itself never
uses that database. Cloud sync uses Supabase through `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (see `.env.example`); without them the app is local-only.
`node scripts/test-rls.mjs` checks the SQL migration and row-level security against a scratch local Postgres. Never commit `.env` (it is git-ignored). Copy `.env.example` if you add one.

## Android: build

Requirements: Node 22, **JDK 21**, Android SDK with platform **36** and build-tools **36.0.0**
(`ANDROID_HOME` set, or open `android/` once in Android Studio).

```bash
npm ci
node scripts/android.mjs debug     # -> android/app/build/outputs/apk/debug/app-debug.apk
node scripts/android.mjs bundle    # -> android/app/build/outputs/bundle/release/app-release.aab
node scripts/android.mjs release   # -> release APK
node scripts/android.mjs sync      # just rebuild the web bundle and copy it into android/
```

The script builds the static web bundle (`scripts/build-android-web.mjs` → `out/`), runs `npx cap sync android`, then Gradle.
The release bundle is **unsigned** unless `android/keystore.properties` exists (see the release guide).

### Install the debug APK on your phone
1. Copy `personal-tracker-1.0.0-debug.apk` to the phone (USB, Drive, or `adb install -r <file>`).
2. Open it from Files and allow “Install unknown apps” for that file manager when asked.
3. Open **Personal Tracker**.

A debug APK is signed with a debug key. Installing a later build signed with a different key requires uninstalling first,
which **deletes the app's records**: export a backup (Settings → Your data) before that.

### Where things are
| Path | What |
| --- | --- |
| `src/tracker/` | The whole app (unchanged architecture) |
| `src/tracker/sync/` | Local-first two-way sync: entity tracking, conflict policy, engine, Supabase store, guest→account merge |
| `src/tracker/components/calendar/` | In-app calendar (month/agenda), event dialog, customization, optional Google card |
| `supabase/` | SQL migration (RLS), `google-calendar` Edge Function |
| `src/tracker/lib/api/mock/persistence.ts` | Versioned migration, record validation, backup parsing |
| `src/tracker/lib/platform/native.ts` | Android detection + Keystore plugin interface |
| `src/tracker/app/NativeBridge.tsx` | Back button, resume, offline notices, system bar style |
| `android/` | Capacitor Android project (custom `SecureKeyPlugin.java`, backup rules, icons, splash) |
| `capacitor.config.ts` | App ID, name, SystemBars/splash config |

Notes: no npm scripts were added because `package.json` is managed by the platform; use the commands above.
