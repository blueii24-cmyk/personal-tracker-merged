# Google Play release guide

Requirements below were checked against Google's page “Meet Google Play's target API level requirement” (last updated 2026‑10‑28):
from **31 Aug 2026** new apps and updates for phones/tablets must target **Android 16 (API 36)** or higher. This project compiles and
targets **36** (minSdk 24). Re-check the page before each release; the rule changes yearly. Nothing is uploaded automatically.

## 1. Before you start
1. Decide the final application ID (`capacitor.config.ts` + `android/app/build.gradle` `applicationId`/`namespace` + `strings.xml`). Currently
   `com.blueii24.personaltracker`. **It can never change after the first upload.**
2. Bump `versionCode` (integer, must increase on every upload) and `versionName` in `android/app/build.gradle`.

## 2. Create an upload key (once)
```bash
keytool -genkeypair -v -keystore personal-tracker-upload.jks -alias upload -keyalg RSA -keysize 4096 -validity 10000
cp android/keystore.properties.example android/keystore.properties   # then fill in path + passwords
```
Keep the `.jks` and passwords in a password manager and a backup. Both are git-ignored; never commit them. Enrol in **Play App Signing**
(default for new apps): Google holds the app signing key, you hold the upload key.

## 3. Build the signed bundle
```bash
node scripts/android.mjs bundle
# -> android/app/build/outputs/bundle/release/app-release.aab (signed with your upload key)
```
Verify it is signed: `jarsigner -verify -verbose android/app/build/outputs/bundle/release/app-release.aab`.
Test the same code first with the debug APK on a real phone (see README).

## 4. Play Console
1. Create app → name “Personal Tracker”, default language, App/Free, accept declarations.
2. **Production or Closed testing → Create release → upload the `.aab`.** New personal developer accounts must run a closed test with the
   required number of testers/days before production access; follow what the Console shows.
3. **App content** section (all required):
   - **Privacy policy URL**: you must host a public page (template below).
   - **Data safety**: see section 5.
   - **Health apps declaration**: Console will ask; the app logs food, calories, protein and body weight but is **not** a medical app
     (no diagnosis, no medical claims, no health-platform integration). Answer accordingly and don't add medical claims to the listing.
   - Ads: none. Target audience: 13+/general (not designed for children). Content rating questionnaire. Government/financial-features
     declaration: it records personal spending only; it moves no money and offers no financial services.
4. Store listing: description, screenshots (phone), 512×512 icon (export `public/favicon.svg` at 512 px), feature graphic 1024×500.

## 5. Data safety form (accurate for this build)
| Question | Answer |
|---|---|
| Does the app collect or share user data? | **No data is collected by the developer.** All records stay on the device. |
| Data sent to a third party | Only if the user switches on the AI assistant with **their own key**: chat text and, when needed to answer, the matching meals/spending/weights go from the device **directly to the provider the user chose**. This is user-initiated, to the user's own account. Declare it conservatively as *Health and fitness* / *Financial info* / *App activity: messages*, “shared” for “app functionality”, optional, only when the user enables it. Re-read Google's current definition of “sharing” and decide with your own judgement. |
| Encrypted in transit | Yes (HTTPS only; cleartext disabled). |
| Can users request deletion | Yes: *Settings → Delete all records*; uninstalling deletes everything. Remove the AI key in Settings → AI assistant. |
| Android Auto Backup | Records (WebView storage) can be included in the user's Google backup if they have it on; the AI key is excluded. Mention this in the policy. |
| Permissions | `INTERNET` only. No location, contacts, storage, camera, notifications. |

## 6. Privacy policy template (edit and host it)
> **Personal Tracker – Privacy Policy** (effective <date>)
> Personal Tracker stores your meals, weights, spending, settings and chats **only on your device**. We (<your name/contact email>) do not
> run a server, create accounts, or receive your data, and we do not use analytics or ads.
> **Optional AI assistant.** If you turn on the assistant and add your own API key from OpenAI, Anthropic, Google or another provider you
> choose, the messages you send, and the records needed to answer your question (for example a day's meals or spending totals), are sent
> directly from your phone to that provider over HTTPS. That provider's terms and privacy policy apply to that data. Without a key, the
> built-in assistant runs entirely on your device. Your key is stored on your device, encrypted with the Android Keystore if you choose
> “this device”.
> **Backups.** If Android backup is enabled on your phone, Google may back up the app's data to your Google account under Google's policy.
> The app also lets you export a file and restore it.
> **Deleting your data.** Use Settings → Delete all records, remove your key in Settings → AI assistant, or uninstall the app.
> **Not medical or financial advice.** Contact: <email>.

## 7. Pre-launch checklist
- [ ] Tested the exact release build on at least one real phone: first launch, restart, background/resume, back button, keyboard in chat,
      export + restore, offline, AI key add/remove, light/dark.
- [ ] Final application ID, version code bumped, keystore backed up.
- [ ] Privacy policy URL live; Data safety and health declarations match the section above.
- [ ] Target API still meets the current Play requirement.
