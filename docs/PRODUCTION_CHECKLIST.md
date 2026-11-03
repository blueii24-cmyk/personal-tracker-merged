# Personal Tracker — exact remaining production checklist

Status snapshot: **2026-11-03**. This file distinguishes inspected hosted configuration from checks that still require credentials, a provider/Google account, or a real device. Never paste secrets into chat, Git, frontend env, Android assets, or logs.

## Known deployment identity and current status

| Item | Inspected state | Still required |
| --- | --- | --- |
| Supabase project | Only intended Personal Tracker project inspected: ref `vvkdqlnbtkdjqmhybatq`, region `ap-south-1`; active/healthy | Do not create/substitute another project |
| Production web | `https://personal-tracker-merged.vercel.app`; READY production deployment inspected at baseline `982624e` | Deploy/review the new PR commit before calling this release current |
| Public Vercel env | Required `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and `NEXT_PUBLIC_AUTH_REDIRECT_URL` names are present | Reconfirm values/targets after future rotation; no server secrets in Vercel client env |
| Auth | Email signup enabled, autoconfirm off, Site URL/allow-list currently limited to the production web URL | Add the exact Android callback below; run real signup/recovery tests |
| Database | The two tracker sync migrations are applied | Review/apply the new default-AI usage migration |
| `google-calendar` | Function v10 ACTIVE; platform JWT check off for its unauthenticated Google GET callback | Required Google/token-encryption secrets are absent; real Google flow is unverified |
| `ai-chat` | New repository implementation, not deployed or configured by this branch | Apply migration, set server-only secrets, deploy, and test provider/quota behavior |
| Android CI | Baseline main run `41323558562` passed; its old debug artifact is not a build of this branch | Require a successful PR Android run and download its new artifact |
| Signing | Existing workflow supports signed release APK/AAB using GitHub secrets | Signing-secret presence and signed artifacts remain unverified; do not claim a signed release |

The baseline artifact (`13090417304`, run `41323558562`) expires 2026-11-15 and is retained only for the previous release. It does not verify this branch.

## 1. Supabase dashboard and CLI

1. Open only project `vvkdqlnbtkdjqmhybatq`. Review recent backups and migration history. Make an appropriate backup before hosted schema work.
2. Link locally and review exactly what will change:

   ```bash
   npx supabase@2.122.0 link --project-ref vvkdqlnbtkdjqmhybatq
   npx supabase@2.122.0 db push --dry-run
   ```

   The dry run should not replace tracker tables. The new migration is `supabase/migrations/20261103000000_default_ai_usage.sql`; the two earlier migrations are already recorded. Only after review:

   ```bash
   npx supabase@2.122.0 db push
   ```

3. **Authentication → URL Configuration:** keep `https://personal-tracker-merged.vercel.app` and add exactly:

   ```text
   com.blueii24.personaltracker://auth/callback
   ```

   Keep Email auth and confirmation enabled. Do not enable anonymous sign-in. The Site URL remains the HTTPS production origin; the native value belongs in Redirect URLs, not in `NEXT_PUBLIC_AUTH_REDIRECT_URL`.
4. **Edge Functions → Secrets:** confirm `APP_ALLOWED_ORIGINS` contains `https://personal-tracker-merged.vercel.app`. The code separately permits Android's existing `https://localhost` WebView origin. Do not add service-role keys as app env or broaden origins with wildcards.
5. Follow [DEFAULT_AI_SETUP.md](./DEFAULT_AI_SETUP.md) for `AI_*` secrets and deployment. The short deployment command after the migration/secrets is:

   ```bash
   npx supabase@2.122.0 functions deploy ai-chat
   ```

   Do not use `--no-verify-jwt`. Confirm ACTIVE + JWT verification on. Configuration alone is not a provider/quota test.
6. Run the two-user/RLS/offline/conflict/merge/auth checklist in [SUPABASE_SETUP.md](./SUPABASE_SETUP.md). These live tests have not been performed by the branch's unit tests.

## 2. Google Cloud and Google Calendar secrets

The exact Google callback for the inspected project is:

```text
https://vvkdqlnbtkdjqmhybatq.supabase.co/functions/v1/google-calendar/callback
```

1. In the intended Google Cloud project, enable **Google Calendar API** and configure OAuth consent. While External/Testing, add the Google test account as a test user.
2. Add only the existing scopes: calendar-list read, calendar-events read, and `calendar.events.owned` solely for the optional user-enabled app-event push.
3. Create/select a **Web application** OAuth client and register the exact callback above. No Android OAuth client or SHA-1 is needed; the callback terminates at the Edge Function.
4. In Supabase Function secrets, set `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, and a securely generated/backed-up base64 32-byte `GOOGLE_TOKEN_ENC_KEY`. These three are currently absent. Do not overwrite or expose the existing `APP_ALLOWED_ORIGINS` value.
5. If deploying from this repository, use:

   ```bash
   npx supabase@2.122.0 functions deploy google-calendar --no-verify-jwt
   ```

   The flag is only for Google's JWT-less GET callback. POST actions must retain their internal user-JWT validation.
6. With a real test user, verify external-browser consent, return/resume, calendar selection, read-only import, repeat/incremental sync, revocation/reconnect, and disconnect. Confirm no Google event is deleted. A v10 ACTIVE shell does not prove any of these steps.

See [GOOGLE_CALENDAR_SETUP.md](./GOOGLE_CALENDAR_SETUP.md) for design and detailed checks.

## 3. GitHub review, Android CI, and signing

1. Review the separate PR; do not merge it without the requested review. Require typecheck, lint, full Vitest, Vercel checks, and **Build Android APK** on the PR commit.
2. The workflow's browser-safe defaults already identify the production project/origin. Repository Variables are optional overrides, not a place for service keys. No public-config change is required unless intentionally rotating the backend.
3. After the PR's debug run succeeds, download its new `Personal-Tracker-Debug-APK` artifact and verify the run/commit/artifact metadata. A green run proves compilation and packaged checks, not hosted Auth/Google/default-AI/device behavior.
4. For a signed release APK or Play AAB, configure these only under **Settings → Secrets and variables → Actions → Secrets**:
   - `ANDROID_UPLOAD_KEYSTORE_BASE64`
   - `ANDROID_KEYSTORE_PASSWORD`
   - `ANDROID_KEY_ALIAS`
   - `ANDROID_KEY_PASSWORD`
5. Run **Build Android APK → workflow_dispatch**, choosing `release` or `bundle`; expected artifacts are `Personal-Tracker-Signed-Release-APK` and `Personal-Tracker-Play-AAB`. The runner decodes signing material only temporarily and cleans it. Do not buy/upgrade a plan or create a new keystore without approval. Keep `com.blueii24.personaltracker` unchanged.

## 4. Vercel deployment

1. Let the existing Personal Tracker Vercel project build the PR preview; review its checks without treating a preview as production verification.
2. After approved merge, confirm the production deployment is READY at the merged commit and still aliases `https://personal-tracker-merged.vercel.app`.
3. Recheck the three public Production env names. No default-AI provider key, Supabase service-role key, Google secret, refresh token, or Android signing secret belongs in Vercel.
4. Test the actual production URL: fresh empty local state, navigation/themes/bottom nav, signup/confirmation, session restart/refresh, offline/reconnect sync, merge/conflicts, default AI, and Google status. Deployment-specific protected preview URLs are not a substitute for production testing.

## 5. Real Android acceptance pass

Use the new debug APK first, exporting data before any uninstall/signature change:

- Fresh install starts empty; no sample records, balances, or targets appear. Existing launcher identity, status bar, hamburger/page titles, drawer branding, themes, bottom navigation, and Android back behavior remain.
- Email confirmation and recovery open `com.blueii24.personaltracker://auth/callback`, return to the app, adopt the session, survive restart, and handle revocation/sign-out safely.
- Offline writes survive process death and upload after resume/reconnect; two users remain isolated; conflicts and guest merge preserve both versions/records.
- Default AI requires sign-in, enforces limits, preserves BYOK/model selection, and writes only through validated service tools.
- Google consent opens externally, imported events are read-only, and returning to the app refreshes status.
- Export/restore works; exact known legacy seeds are cleaned only after a safety copy, while unknown `demo-` and legitimate records survive.

Record every unrun item as **unverified**, not as a pass.
