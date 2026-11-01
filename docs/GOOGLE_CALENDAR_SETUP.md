# Google Calendar (optional) – setup and design

Nothing here is needed for the in-app calendar. Until these steps are done the app shows "Google Calendar isn't set up on the server yet" and does not pretend otherwise. **This integration has not been tested against a real Google account**; only its pure logic (scopes, PKCE, encryption, event mapping, failure classification) is covered by automated tests.

## How it works
* Separate from Supabase sign-in: you must be signed in to the app, then press **Connect Google Calendar**.
* Authorisation-code flow with PKCE and state, run by the `google-calendar` Edge Function. The Google client secret and refresh token live only there. The refresh token is encrypted (AES-256-GCM) in `google_calendar_connections`, a table clients cannot read or write.
* The browser/APK only receives status, calendar names and the Google consent URL, never a token. Each request carries the user's Supabase JWT, which the function validates.
* Android: the consent page opens in the **system browser (Chrome Custom Tab)**, never in the app WebView; no client secret, Android OAuth client, SHA-1 or deep link is needed because the redirect goes to the Edge Function. The app re-checks the connection when you return to it. App ID `com.blueii24.personaltracker` and the WebView origin are unchanged.
* Scopes: `calendar.calendarlist.readonly` + `calendar.events.readonly` by default. `calendar.events.owned` is requested only if you turn on "Also add my in-app events to this Google calendar".
* Events are copied into `calendar_events` (read-only, `origin = 'google'`) with their Google id, etag and a unique index, so repeated syncs never duplicate them. Incremental sync tokens are used; an expired token (HTTP 410) triggers a full re-read. Revoked access marks the connection "Reconnect needed". Rate limits keep the old sync token and report a partial result.
* Ownership: app events can be pushed to Google (create/update) if you opt in; Google events can't be edited here. **Nothing is ever deleted in Google Calendar** by this app: deleting an app event, switching calendar or disconnecting only removes this app's own copies.

## Google Cloud Console
1. Create a project; **APIs & Services → Library → Google Calendar API → Enable**.
2. **OAuth consent screen**: External; add the app name, support e-mail; add the scopes above; while in *Testing*, add your Google account under **Test users** (testing-mode refresh tokens expire after 7 days; publishing needs Google's verification for these sensitive scopes).
3. **Credentials → Create credentials → OAuth client ID → Web application**.
   Authorised redirect URI: `https://YOUR-PROJECT-REF.supabase.co/functions/v1/google-calendar/callback`
4. Copy the client ID and secret into Supabase secrets (below); never into the app or Git.

## Supabase
```
supabase secrets set GOOGLE_CLIENT_ID=... GOOGLE_CLIENT_SECRET=... \
  GOOGLE_TOKEN_ENC_KEY=$(openssl rand -base64 32) \
  APP_ALLOWED_ORIGINS=https://your-web-app.example
supabase functions deploy google-calendar --no-verify-jwt
```
`--no-verify-jwt` is required because Google's redirect has no Supabase JWT; every other request is authenticated inside the function (`authenticate()`). Keep `GOOGLE_TOKEN_ENC_KEY` safe: losing it means users must reconnect. `APP_ALLOWED_ORIGINS` is the comma-separated list of HTTPS web origins allowed to call the function and to be redirected to after consent; put the primary web origin first because it is used for the post-consent web return. The Android WebView origin `https://localhost` is always allowed to call the function.

### Dashboard checks after deployment
Use the intended Supabase project, not another project in the same organisation:
1. **Project Settings → Edge Functions → Secrets** (or the **Edge Functions → Secrets** page in the current dashboard): confirm exactly
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_ENC_KEY`, and `APP_ALLOWED_ORIGINS` are set. Never move these into
   `NEXT_PUBLIC_*`, GitHub Variables, the APK, or chat. Rotate the Google secret/encryption key only with a reconnect plan.
2. **Edge Functions → google-calendar**: confirm the function is deployed from this repository and platform JWT verification is disabled
   only because the OAuth callback cannot carry a JWT. Do not disable the function's internal `authenticate()` check for POST actions.
3. **Google Cloud → APIs & Services → Credentials → your Web OAuth client**: confirm the authorised redirect URI is exactly
   `https://YOUR-PROJECT-REF.supabase.co/functions/v1/google-calendar/callback` for that same project. No Android OAuth client or SHA-1 is
   used by this flow.
4. **Google Cloud → OAuth consent screen → Audience/Test users**: add the Google account used for testing while the app remains in Testing.
   Enable Google Calendar API and grant only the scopes listed above.

### Required real-account/Android verification
These remain manual even when unit tests and Android CI pass:
1. Sign in to the app, connect Google in the system browser, complete consent as the registered test user, close the callback page, and return
   to the app. Confirm status changes to connected without asking for tokens or opening consent inside the WebView.
2. Select a calendar and sync. Confirm imported events are read-only, repeat sync to check for duplicates, and edit offline to confirm normal
   tracker sync still works. Switch calendars and disconnect: old imported copies must disappear through tombstones while app-owned events
   remain; verify directly in Google that no event was deleted.
3. Reconnect, revoke access at **Google Account → Security → Third-party access**, and confirm the app reports **Reconnect needed**. If you
   enabled optional push, verify create/update of app-owned events and that Google-originated events remain read-only.
4. Inspect Supabase Edge Function logs for action/error codes only. Stop immediately if a URL, refresh token, client secret, or event payload
   is logged; none should be.
