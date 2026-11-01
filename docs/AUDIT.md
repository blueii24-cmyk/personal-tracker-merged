# Audit, fixes and test results

## Architecture found
- Next.js 16 shell → one client-only React Router app (`src/tracker`, loaded with `ssr:false`).
- **Storage:** `localStorage` key `pt.demo.db.v1` (records + chats), `pt.ai.config.v1` (AI settings, no key), `pt.theme`.
- **AI:** bring-your-own-key, calls OpenAI / Anthropic / Gemini / OpenAI-compatible servers **directly from the device**
  with a fixed system prompt and eight validated tools. Chat turns are idempotent on `clientMessageId`.
- **Backend:** none needed. The only server code is `/api/health` (hosting template). Supabase is mentioned in comments only;
  nothing is wired to it. No service-role credentials exist anywhere.
- Tests found: 90 (calculations, demo assistant, BYOK adapters/tools). All passed before changes.

## Findings and what was done

### Critical
| # | Finding | Status |
|---|---|---|
| C1 | Saving to storage swallowed every error → UI showed records that were never saved (silent data loss) | **Fixed.** Writes are all-or-nothing: failure rolls back and shows “Couldn't save to this device…” (`STORAGE_FAILED`). Test: *rolls back and reports an error when the device refuses a save*. |
| C2 | Unreadable stored data was silently replaced by sample data and then overwritten | **Fixed.** The original text is copied to `pt.demo.db.v1.unreadable.<time>` first, a one-time notice is shown. Data from a **newer** schema is never touched. Tests added. |
| C3 | No restore/import: exported files could not be restored | **Fixed.** Settings → Your data → *Restore from backup*: strict validation (all-or-nothing), counts shown, confirmation before replacing. Old exports (no format fields) still restore. E2E-verified round trip. |
| C4 | Android WebView ignores `<a download>`/blob exports → export would silently do nothing | **Fixed.** On Android the file is written to private cache and the system share sheet opens (no storage permission). Old export files are deleted before each new one. *(Share sheet itself unverified on a device.)* |
| C5 | API key stored in `localStorage` in plain text | **Fixed for Android.** “This device” = AES-256-GCM with a non-exportable Android Keystore key (`SecureKeyPlugin.java`); “this tab” = memory/session only; key never goes to `localStorage` on Android; keys can still be updated/removed. Excluded from Android backups. *(Unverified on a device.)* |

### High
| # | Finding | Status |
|---|---|---|
| H1 | NaN/Infinity calories, protein, quantity and invalid dates passed validation (`NaN < 0` is false) | **Fixed** in service validation and on load/import. |
| H2 | Amounts like 10.005 stored with more than 2 decimals | **Fixed:** rounded to paise on create/edit/load. |
| H3 | `AbortSignal.timeout/any` crash AI calls on Android WebViews older than Chrome 124/116 | **Fixed** with fallbacks. Test added. |
| H4 | Day rollover and resume: timers pause in the background so “today” could be stale after returning | **Fixed:** re-check on `visibilitychange`, focus and Capacitor `resume`; records re-read on resume. |
| H5 | Top of the UI would sit under the status bar once edge-to-edge is enforced (targetSdk 36) | **Fixed:** the app shell pads with `env(safe-area-inset-*)` (0 in browsers → no visual change). |
| H6 | No way to delete all data / no warning text about local-only storage | **Fixed:** *Delete all records* with confirmation; explanatory text in Your data. |

### Medium
- Offline AI calls waited for a 60 s timeout → now fail immediately with a clear message; “offline/back online” notices added.
- Chat idempotency log (`processed`) grew forever → capped at the newest 200.
- Android back button: closes the open dialog, then navigates back, then exits at the home screen.
- Status/navigation-bar icon style follows the app theme (light/dark); window and splash background match the theme.
- Lint: 8 pre-existing errors (unescaped apostrophes, a ref written during render) → fixed; lint is clean.
- Misleading wording “this browser” → “on this device” inside the Android app.

### Reviewed and found correct (left alone)
Money maths via integer paise; nutrition via tenths with unknown ≠ 0; timezone-keyed dates (`Asia/Kolkata` default); monthly budget
vs. tracked balance separation; INR formatting; BYOK key redaction in errors; HTTPS-only endpoint validation; tool-call dedupe,
write limits and “no invented values” rules; double-submit protection (buttons disable while saving; chat ignores sends while one is in flight).

### Low / not changed
- The app starts with **sample data** (existing “demo” design). Use *Delete all records* for an empty start. Changing the first-run experience was out of scope.
- Reads have an artificial 120 ms latency (existing). Left to preserve behaviour.
- No SQLite migration: the data set is small (5,500 records render in ~0.5 s) and a migration adds risk. `migrateDb()` is the versioned hook if that changes.

## Android compatibility changes
Capacitor 8.6 project, `com.blueii24.personaltracker`, versionName 1.0.0 / versionCode 1, minSdk 24, compile/target SDK 36;
adaptive + monochrome + legacy icons drawn from `favicon.svg`; Android 12 splash screen on the app's background colour; edge-to-edge via
`EdgeToEdge.enable` + Capacitor SystemBars (`insetsHandling: css`, keyboard inset handled natively); only the `INTERNET` permission;
cleartext traffic off and system-CA-only trust (`network_security_config.xml`); `allowMixedContent` off, WebView debugging off;
Auto Backup on for records, the encrypted key excluded; rotation handled without restarting; share/export via the share sheet; file restore via the system file picker.

## Files
**New:** `capacitor.config.ts`, `.gitignore`, `README.md`, `docs/AUDIT.md`, `docs/ANDROID_RELEASE.md`, `docs/screenshots/*`,
`scripts/android.mjs`, `scripts/build-android-web.mjs`, `scripts/e2e-static-bundle.mjs`, `android/**` (Capacitor project; custom:
`MainActivity.java`, `SecureKeyPlugin.java`, `res/xml/{backup_rules,data_extraction_rules,network_security_config}.xml`, `res/values*/colors.xml`,
icons/splash drawables, `keystore.properties.example`), `src/tracker/lib/platform/native.ts`, `src/tracker/lib/api/mock/persistence.ts`,
`src/tracker/app/NativeBridge.tsx`, tests `persistence.test.ts`, `offline.test.ts`.
**Modified:** `next.config.ts`, `eslint.config.mjs`, `src/app/[[...slug]]/page.tsx`, `mock-tracker-service.ts`, `tracker-service.ts`, `errors.ts`,
`byok/config.ts`, `byok/http.ts`, `AiConfigProvider.tsx`, `TrackerProvider.tsx`, `providers.tsx`, `AppShell.tsx`, `DemoNotice.tsx`,
`SettingsSections.tsx`, `AiSection.tsx`, `ChatPage.tsx`, `AccountMenu.tsx`, `settings/export.ts`; `package.json` gained Capacitor packages through the installer.

## Test results (what was actually run)
| Check | Result |
|---|---|
| `npx vitest run` | **106 passed** (90 original + 16 new) |
| `npx eslint .` | clean |
| `tsc --noEmit`, `next typegen`, `npm run build` | pass (final run, see end of session) |
| Static Android web export | pass (`out/`, 2.7 MB) |
| `gradlew assembleDebug`, `bundleRelease`, `assembleRelease` | pass; APK inspected with `aapt2`: package, targetSdk 36, only `INTERNET`; `apksigner verify` OK for debug APK |
| Headless Chromium (393×851 phone, landscape, tablet) against the exported bundle served like Capacitor (`scripts/e2e-static-bundle.mjs`): first launch, 5 routes as deep links, export, dialog cancel (back-button path), erase, empty DB, restore, invalid backup rejected, reload persistence, offline notice, corrupt-data recovery, 5,500 records (History 0.5 s, Budget 0.9 s), no page errors | **all 21 passed** |

### NOT verified (no emulator or device was available: no KVM in the build sandbox)
- Installing/launching the APK; the real Android WebView; splash/icon rendering; system bar colours; edge-to-edge insets on real devices.
- `SecureKeyPlugin` (Keystore) at runtime; the share sheet; the system file picker; the physical back button; keyboard behaviour with the chat input.
- Live calls to OpenAI/Anthropic/Gemini (no keys were used). Provider CORS from the `https://localhost` WebView origin is unverified; if a provider blocks it, chat will show the existing network/CORS message.
- Play Console steps (nothing was uploaded).

## Remaining limitations
- Records exist only on the device (plus Android Auto Backup if the user has it enabled). No sync, no accounts.
- A client-side key can be extracted by someone controlling the device; the Keystore protects it at rest only.
- “Other (OpenAI-compatible)” servers must be HTTPS; `http://localhost` (Ollama) is blocked on Android by design.
- Debug builds use a debug key; switching signing keys needs an uninstall (which deletes data).
- WebView-based: needs Android System WebView (Chrome) kept reasonably current.
- Release minification is off (Capacitor plugins use reflection) → slightly larger APK.


---

# Addendum: AI error diagnosis, cloud sync, calendar, Google Calendar

## AI provider errors (diagnosed from the code; no live provider call was made)
Found in `byok/http.ts`: every 401/403 was reported as "didn't accept this API key" (403 is also region blocks, disabled APIs and
model permissions); Gemini reports a bad key as **HTTP 400** `API_KEY_INVALID` and was shown as a generic "rejected the request"; an
OpenAI `429 insufficient_quota` and an Anthropic 400 "credit balance too low" were shown as "wait and retry" / "rejected" although the key
was fine; a custom server's HTML 403/200 page was not recognised; connection/CORS failures did not say they were not a key problem.
Fixed with `byok/diagnose.ts`: each failure now has a code (`HTTP_401/KEY_INVALID`, `QUOTA_EXCEEDED`, `REGION_BLOCKED`, `API_NOT_ENABLED`,
`PERMISSION_DENIED`, `MODEL_NOT_FOUND`, `ENDPOINT_NOT_FOUND`, `BLOCKED_BY_SERVER`, `RATE_LIMITED`, `TIMEOUT`, `OFFLINE`, `NETWORK_OR_CORS`,
`BAD_RESPONSE`), a concrete action, and sanitised provider text (key, bearer tokens, key-shaped strings and markup removed).
Settings → AI shows "Key saved, not verified" until **Test connection** passes ("Provider verified"). HTTPS-only endpoints and the Android AbortSignal
fallbacks are unchanged. 16 mocked-fetch tests cover 401/403/404/429/5xx, CORS/network, timeout (with and without `AbortSignal.timeout/any`), abort,
malformed replies, redaction. **Not verified:** any real provider call, and whether a provider blocks the Android WebView origin.

## Cloud sync (Supabase), calendar, Google Calendar
See `docs/SUPABASE_SETUP.md` and `docs/GOOGLE_CALENDAR_SETUP.md`. New code is in `src/tracker/sync`, `src/tracker/components/{account,calendar}`,
`src/tracker/features/{auth,calendar}`, `supabase/`. The existing screens, routes and calculations are unchanged; the service gained calendar methods and a
local-first synced implementation (`SyncedTrackerService`, which behaves exactly like the previous local service when signed out).

### Limitations of this addendum
* Never run against a live Supabase project or Google account (none available). SQL/RLS verified on plain Postgres with Supabase role/`auth` stand-ins (58 checks).
* The Supabase client wiring (`SupabaseRemote`, auth UI) is type-checked and exercised only through a fake remote that mimics the revision guard.
* Conflict resolution uses device clocks for "later wins"; a badly wrong clock can pick the older edit, but the other version is always kept for review.
* Supabase's auth session (not an AI key, not a Google token) is stored by supabase-js in the WebView's localStorage and is part of Android Auto Backup like other app data.
* "Delete all records" and "Restore" while signed in apply to the account's copy too (they are ordinary tracked changes).
* Calendar events are not removed by "Delete all records" (that action is documented as meals, transactions, weigh-ins and chats).
