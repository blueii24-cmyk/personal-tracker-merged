# Google Play release guide

Requirements below were checked against Google's page “Meet Google Play's target API level requirement” (last updated 2026‑10‑28):
from **31 Aug 2026** new apps and updates for phones/tablets must target **Android 16 (API 36)** or higher. This project compiles and
targets **36** (minSdk 24). Re-check the page before each release; the rule changes yearly. Nothing is uploaded automatically.

## 1. Before you start
1. Keep the application ID (`capacitor.config.ts` + `android/app/build.gradle` `applicationId`/`namespace` + `strings.xml`) as
   `com.blueii24.personaltracker`. **It can never change after the first upload.** Changing the WebView origin/scheme can also orphan local data.
2. Bump `versionCode` (integer, must increase on every upload) and `versionName` in `android/app/build.gradle`.
3. Configure the intended Supabase project as described in `docs/SUPABASE_SETUP.md`. Android CI refuses to produce a silently local-only
   package: both public Supabase values are required and their exact values are checked inside the built APK/AAB. They are public client
   configuration, not signing credentials; the service-role/secret key is never allowed.

## 2. Create an upload key (once)
```bash
keytool -genkeypair -v -keystore personal-tracker-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
cp android/keystore.properties.example android/keystore.properties   # then fill in path + passwords for local builds only
```
Keep the `.jks` and passwords in a password manager and a backup. Both are git-ignored; never commit them. Enrol in **Play App Signing**
(default for new apps): Google holds the app signing key, you hold the upload key. The same upload key must be retained for future updates.

## 3. Build in GitHub Actions (recommended)
The existing **Build Android APK** workflow uses Node 22, JDK 21, Android SDK 36/build-tools 36.0.0 and `scripts/android.mjs`.

1. The workflow includes the browser-safe Personal Tracker production defaults. To rotate them or use another environment, override them in **GitHub repository → Settings → Secrets and variables → Actions → Variables**:
   - `NEXT_PUBLIC_SUPABASE_URL`
   - `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (publishable or legacy anon key, never a secret/service-role key)
   - `NEXT_PUBLIC_AUTH_REDIRECT_URL`, the HTTPS web origin/path used for email confirmation and recovery.
2. For `release` or `bundle`, open the **Secrets** tab on the same page and add:
   - `ANDROID_UPLOAD_KEYSTORE_BASE64`: base64 of the existing upload `.jks`
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS`
   - `ANDROID_KEY_PASSWORD`
   Never place these in Variables, files, logs, or chat. Losing the upload key or passwords can prevent updates.
3. **Actions → Build Android APK → Run workflow**, then choose:
   - `debug` → `Personal-Tracker-Debug-APK` for phone testing;
   - `release` → `Personal-Tracker-Signed-Release-APK` for signed direct-install testing;
   - `bundle` → `Personal-Tracker-Play-AAB` for Play Console upload.
4. Download the artifact only after the run succeeds. The workflow verifies the APK/AAB signature, the APK application ID and launcher
   label, and the exact public Supabase configuration inside the package. It does not print those values.
5. The keystore is decoded only into the runner's temporary directory, `android/keystore.properties` exists only during the job, and an
   always-run cleanup removes signing material and extracted package files. Artifacts expire after 14 days. GitHub-hosted runners are
   ephemeral, but your keystore backup remains your responsibility.

The preflight validates the effective public defaults and any repository-variable overrides, and stops before a build if they are absent or malformed.
A successful old debug run does not prove the intended values were packaged; use a run of this updated workflow and its packaged-asset verification.

## 4. Build locally (alternative)
Set the same public values in `.env.local`, create the local signing files from section 2, then run:
```bash
npm ci
npm run typecheck && npm run lint && npx vitest run
node scripts/android.mjs release  # signed APK for direct-install testing
node scripts/android.mjs bundle   # -> android/app/build/outputs/bundle/release/app-release.aab
```
Verify the bundle without printing signing credentials: `jarsigner -verify -strict android/app/build/outputs/bundle/release/app-release.aab`.
Test the same code first with the debug APK on a real phone (see README). Do not commit `.env.local`, `android/local.properties`,
`android/keystore.properties`, or any keystore.

## 5. Play Console
1. Create app → name “Personal Tracker”, default language, App/Free, accept declarations.
2. **Production or Closed testing → Create release → upload the signed `.aab`.** New personal developer accounts must run a closed test with
   the required number of testers/days before production access; follow what the Console shows.
3. **App content** section (all required):
   - **Privacy policy URL**: host a public policy that accurately describes the optional account/cloud and Google Calendar features.
   - **Data safety**: see section 6. Answers depend on which optional features you enable; do not reuse an “entirely local/no collection”
     declaration for a cloud-enabled build.
   - **Health apps declaration**: the app logs food, calories, protein and body weight but is **not** a medical app (no diagnosis, medical
     claims, or health-platform integration). Answer accordingly and don't add medical claims to the listing.
   - Ads: none. Target audience: 13+/general (not designed for children). Content rating questionnaire. Government/financial-features
     declaration: it records personal spending only; it moves no money and offers no financial services.
4. Store listing: description, screenshots (phone), 512×512 icon (export `public/favicon.svg` at 512 px), feature graphic 1024×500.

## 6. Data safety form (feature-dependent; verify against the current Console)
| Question | What this build actually does |
|---|---|
| Local-only use | With no account/cloud connection, tracker records stay in app storage. This is not an accurate description after the user enables Supabase sync, Google Calendar, or an external AI provider. |
| Optional account and cloud sync | If enabled, the user's email/account identifier and the tracker records they choose to sync are sent over HTTPS to the configured Supabase project and stored for sync and conflict handling. Declare the corresponding account, health/fitness, financial, calendar, and message/app-activity categories conservatively. |
| Optional Google Calendar | After separate Google consent, the Edge Function reads the selected calendar and stores read-only imported copies in Supabase. If the user opts in, app-owned events are also sent to Google. The function stores an encrypted Google refresh token. Disconnecting tombstones imported copies and revokes/deletes the stored connection; it never deletes events in Google. |
| Optional AI assistant | With the user's own key, chat text and the records needed to answer go directly from the device to the provider the user chose. Declare this user-initiated sharing conservatively. Without a key, the built-in assistant remains on-device. |
| Encrypted in transit | Yes (HTTPS only; Android cleartext traffic is disabled). |
| Deletion | *Settings → Delete all records* deletes the selected local/account tracker records; uninstalling removes local app data. This is record deletion, **not deletion of the Supabase Auth user or the user's Google account**. If account creation is enabled, satisfy Play's current in-app/web account-deletion requirements before release. |
| Android Auto Backup | Local records (WebView storage) can be included in the user's Google backup if enabled; the Android-Keystore-protected AI key is excluded. Mention this in the policy. |
| Permissions | `INTERNET` only. No location, contacts, storage, camera, or notification permission is requested. |

Google's definitions of “collection” and “sharing” and its account-deletion rules change; review the live Console rather than treating this
table as a legal determination.

## 7. Privacy policy template (edit and host it)
> **Personal Tracker – Privacy Policy** (effective <date>)
>
> Personal Tracker stores meals, weights, spending, calendar records, settings and chats on your device by default. We
> (<your name/contact email>) do not use analytics or ads.
>
> **Optional account and cloud sync.** If cloud sync is available and you create an account or sign in, your email/account identifier and
> tracker records are transmitted to and stored in our configured Supabase project so they can sync between your devices and preserve
> conflict state. Signed-in records are isolated by per-user access controls. Local records are not discarded merely because you
> sign in; the first-sign-in merge requires your review. You can use the app without an account.
>
> **Optional Google Calendar.** If you connect Google, you authorise our Supabase Edge Function through Google to read the calendar you
> select and store read-only copies with your synced records. A Google refresh token is encrypted and kept only in the server-side connection
> store. Only if you separately opt in are app-owned events sent to Google. The app never deletes events from Google Calendar. Disconnecting
> revokes/deletes the stored connection and removes the app's imported copies through sync tombstones.
>
> **Optional AI assistant.** If you turn on the assistant and add your own API key from OpenAI, Anthropic, Google or another provider you
> choose, the messages you send, and the records needed to answer your question, are sent directly from your phone to that provider over
> HTTPS. That provider's terms and privacy policy apply. Without a key, the built-in assistant runs on your device. Your key is stored on
> your device, encrypted with the Android Keystore if you choose “this device”; it is not included in Supabase sync.
>
> **Backups.** If Android backup is enabled, Google may back up the app's local data under Google's policy. The app also lets you export and
> restore a file.
>
> **Deleting your data.** Use Settings → Delete all records for local/account tracker records, remove your AI key in Settings, disconnect
> Google Calendar, or uninstall the app. Explain here how a user can request deletion of the Supabase Auth account itself; record deletion
> alone is not auth-account deletion.
>
> **Not medical or financial advice.** Contact: <email>.

## 8. Pre-launch checklist
- [ ] Tested the exact signed release/AAB-derived build on at least one real phone: first launch, restart, background/resume, back button,
      keyboard in chat, export + restore, offline, AI key add/remove, light/dark, and no duplicate native action bar.
- [ ] Tested sign-up, confirmation, sign-in/out, recovery, persistent sessions, two-user isolation, first-sign-in merge, offline edits,
      conflict review, and automatic/manual sync against the intended Supabase project.
- [ ] Tested Google consent/return, read-only imports, calendar switching, disconnect/reconnect, optional push, and revocation with a real
      Google test user; confirmed no Google event was deleted.
- [ ] Final application ID, version code bumped, upload key backed up, Actions artifact/signature checks passed.
- [ ] Privacy policy URL live; Data safety, account deletion, and health declarations match the enabled features.
- [ ] Target API still meets the current Play requirement.
