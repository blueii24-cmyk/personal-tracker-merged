# Google ecosystem integration: work in progress

**Not ready to activate.** The Sheets API and queue modules in this branch are
building blocks only: no OAuth flow, deployed function, tracker event wiring,
settings controls, spreadsheet link, or Health Connect plugin is present yet.
They do not export anything, request Google permissions, or change existing
Calendar connections. Do not deploy or use these modules with real data until
the remaining work and security review are complete.

## Existing boundary and proposed design

Personal Tracker saves locally through `SyncedTrackerService`; Supabase sync is
separate. Google Calendar already uses its own Supabase Edge Function, PKCE,
encrypted refresh tokens, account-scoped storage and optional calendar write
scope. Keep it intact. A future Sheets integration needs its **own** scoped
consent and connection record, securely encrypted refresh token, selected
spreadsheet ID, and authenticated server-side function. Never return a refresh
token to the browser/APK. Do not reuse Calendar's token without a deliberate
migration: disconnect/reconsent of one integration must not break the other.

The `supabase/functions/_shared/sheets-core.ts` prototype calls the official
Sheets REST API with a server-supplied access token. It can create a spreadsheet,
add missing tabs, and update or append a row by ID. Writes use `RAW` values so
text cannot become a Sheets formula; altered headers and duplicate IDs fail
closed. It is **not** a deployed endpoint. The prototype lacks formatting beyond
frozen/bold headers and filters, mapping domain records, log writes, and a durable
server-side account lock. A network failure during spreadsheet creation is
ambiguous; blindly repeating creation can make a second file.

The `src/tracker/lib/google/sheets-queue.ts` prototype stores account-partitioned
changes locally, coalesces updates, and keeps failed changes for retry. It is not
wired to tracker saves or a scheduler. It only serializes calls within one
instance, not across tabs, devices or processes. Fields are caller-provided;
the final mapper must explicitly whitelist export data and never enqueue chat,
keys, OAuth tokens, passwords, or account credentials. Queue storage can fail:
the app must show that failure without rolling back an already successful
tracker save or incorrectly claiming that a change was queued. An atomic
outbox/reconciliation strategy is needed to cover a crash between record save
and queue insertion. Do not use the current prototype for production data.

For meals, the current data model supports multiple food items per meal. The
single-row adapter does not yet define a lossless stable representation for
multiple items and edits/removals. Define and test that representation before
wiring exports. The domain model also does not expose created/updated timestamps
for all records; do not fabricate timestamps or payment details.

## Configuration and activation checklist (not yet actionable)

- [ ] Complete and review the isolated OAuth callback, state validation, server
      token encryption, account binding, disconnect/reconnect, and permission UI.
- [ ] Enable the Google Sheets API in the intended Google Cloud project and
      configure the OAuth consent screen/test users and Web client redirect URI
      for the eventual function; exact callback URL depends on that implementation.
- [ ] Request `https://www.googleapis.com/auth/drive.file` for app-created or
      explicitly selected files, after verifying that the chosen create/open
      workflow works with this scope. See [Sheets authorization](https://developers.google.com/workspace/sheets/api/scopes).
      No Gmail, Photos, Contacts, or broad Drive access is needed.
- [ ] Review and apply any future Supabase migrations only with explicit
      authorization; deploy functions and configure secrets only after review.
      Never put client secrets or refresh tokens in public environment variables,
      source control, an APK, or chat.
- [ ] Complete record mapping, account-scoped durable capture, retries, lifecycle
      scheduling, deletion tombstones, settings, and truthful sync status; test
      with a separate non-production Google account and test data.
- [ ] Implement Health Connect on Android with the official AndroidX SDK. Check
      availability on device, request each relevant read permission with an
      explanation, support revocation/denial, preserve data provenance, and
      isolate imported readings from manual records. Android 14 includes Health
      Connect; compatible earlier versions may require the app. Follow the
      [official setup guide](https://developer.android.com/health-and-fitness/health-connect/get-started)
      for manifest declarations, privacy policy activity, permissions and Play
      Console health declarations. No Health Connect permissions are currently
      declared or requested.
- [ ] Separately assess Google Health API configuration, policy/approval and
      restricted health data handling. [Google says](https://developers.google.com/health)
      it supports metrics from Fitbit, Pixel Watch and other devices. Health
      Connect is a different on-device path. Neither is implemented here; do not
      use deprecated Google Fit APIs as a substitute.

## Future Work — Data Integrity & Synchronization Certification

This remains deliberately open: end-to-end integrity certification, bidirectional
sync, advanced conflict resolution, arbitrary manual-sheet-edit reconciliation,
large historical backfill validation, multi-device concurrency stress tests,
disaster recovery/restore certification, and any proof of zero loss/duplication.
Even the initial one-way feature must first address basic offline capture,
account isolation, serialized writes, idempotency and truthful error reporting.
