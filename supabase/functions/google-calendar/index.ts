// Supabase Edge Function: optional Google Calendar connection (Deno).
// Secrets (set with `supabase secrets set`, never in the app or Git):
//   GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_TOKEN_ENC_KEY (base64, 32 bytes), APP_ALLOWED_ORIGINS (comma list, e.g. https://your-site.example)
// SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY are provided by the platform. Tokens are never returned to the client or logged.
// @ts-nocheck - Deno runtime, type-checked by the Supabase CLI rather than by the app's tsconfig.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import {
  allowedReturn, buildAuthUrl, classifyGoogleError, decryptToken, encryptToken, hasWriteScope, localEventId, pkcePair,
  randomState, sha256Hex, toAppEvent, toGoogleBody,
} from '../_shared/google-core.ts';

const env = (k: string) => (Deno.env.get(k) ?? '').trim();
const CLIENT_ID = env('GOOGLE_CLIENT_ID');
const CLIENT_SECRET = env('GOOGLE_CLIENT_SECRET');
const ENC_KEY = env('GOOGLE_TOKEN_ENC_KEY');
const ORIGINS = env('APP_ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean);
const configured = Boolean(CLIENT_ID && CLIENT_SECRET && ENC_KEY);
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });
const REDIRECT_URI = `${env('SUPABASE_URL')}/functions/v1/google-calendar/callback`;

const corsFor = (req: Request) => {
  const origin = req.headers.get('origin') ?? '';
  const ok = origin === 'https://localhost' || ORIGINS.includes(origin);
  return { 'Access-Control-Allow-Origin': ok ? origin : 'null', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type', 'Access-Control-Allow-Methods': 'POST, OPTIONS', Vary: 'Origin' };
};
const json = (req: Request, status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { ...corsFor(req), 'content-type': 'application/json' } });
const fail = (req: Request, status: number, code: string, message: string) => json(req, status, { error: { code, message } });

async function authenticate(req: Request): Promise<string | null> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data, error } = await admin.auth.getUser(jwt);
  return error || !data.user ? null : data.user.id;
}

async function googleFetch(url: string, init: RequestInit, token: string) {
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), authorization: `Bearer ${token}`, 'content-type': 'application/json' } });
  let body: unknown = null;
  try { body = await res.json(); } catch { body = null; }
  return { res, body };
}

/** Exchange the stored refresh token for a short-lived access token. A revoked token marks the connection for re-consent. */
async function accessToken(userId: string, conn: Record<string, string>): Promise<string> {
  const refresh = await decryptToken(conn.encrypted_refresh_token, ENC_KEY);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, refresh_token: refresh, grant_type: 'refresh_token' }),
  });
  const b = await r.json().catch(() => ({}));
  if (!r.ok || !b.access_token) {
    const k = classifyGoogleError(r.status, b);
    if (k.kind === 'token_revoked' || b.error === 'invalid_grant') {
      await admin.from('google_calendar_connections').update({ status: 'needs_reconsent', last_error: 'Google access was revoked or expired. Reconnect to continue.', updated_at: new Date().toISOString() }).eq('user_id', userId);
      throw Object.assign(new Error('needs_reconsent'), { code: 'needs_reconsent' });
    }
    throw Object.assign(new Error('token_refresh_failed'), { code: 'google_unavailable' });
  }
  return b.access_token as string;
}

async function getConn(userId: string) {
  const { data } = await admin.from('google_calendar_connections').select('*').eq('user_id', userId).maybeSingle();
  return data as Record<string, any> | null;
}
async function userTz(userId: string): Promise<string> {
  const { data } = await admin.from('user_settings').select('timezone').eq('user_id', userId).maybeSingle();
  return (data?.timezone as string) || 'Asia/Kolkata';
}

async function callback(req: Request, url: URL): Promise<Response> {
  const plain = (status: number, text: string) => new Response(text, { status, headers: { 'content-type': 'text/plain; charset=utf-8' } });
  const state = url.searchParams.get('state') ?? '';
  const code = url.searchParams.get('code') ?? '';
  if (!configured || !state) return plain(400, 'Google Calendar is not configured.');
  const hash = await sha256Hex(state);
  const { data: st } = await admin.from('google_oauth_states').select('*').eq('state_hash', hash).maybeSingle();
  await admin.from('google_oauth_states').delete().eq('state_hash', hash); // single use
  if (!st || new Date(st.expires_at) < new Date()) return plain(400, 'This sign-in link expired. Go back to the app and try Connect again.');
  const back = (ok: boolean) => {
    const web = allowedReturn(`${ORIGINS[0] ?? ''}/calendar?google=${ok ? 'connected' : 'error'}`, ORIGINS);
    return st.return_to === 'web' && web ? Response.redirect(web, 302) : plain(ok ? 200 : 400, ok ? 'Google Calendar connected. You can close this tab and return to the app.' : 'Google Calendar could not be connected. Return to the app and try again.');
  };
  if (url.searchParams.get('error') || !code) return back(false);
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: CLIENT_ID, client_secret: CLIENT_SECRET, code, code_verifier: st.code_verifier, redirect_uri: REDIRECT_URI, grant_type: 'authorization_code' }),
  });
  const tok = await r.json().catch(() => ({}));
  if (!r.ok || !tok.access_token) return back(false);
  const existing = await getConn(st.user_id);
  const refreshToken = tok.refresh_token ?? (existing ? await decryptToken(existing.encrypted_refresh_token, ENC_KEY) : null);
  if (!refreshToken) return back(false);
  const { res, body } = await googleFetch('https://www.googleapis.com/calendar/v3/users/me/calendarList/primary', {}, tok.access_token);
  const email = res.ok ? (body?.id ?? null) : null;
  await admin.from('google_calendar_connections').upsert({
    user_id: st.user_id, encrypted_refresh_token: await encryptToken(refreshToken, ENC_KEY), scope: tok.scope ?? '', google_email: email,
    selected_calendar_id: existing?.selected_calendar_id ?? (res.ok ? body?.id : null), selected_calendar_name: existing?.selected_calendar_name ?? (res.ok ? body?.summary : null),
    sync_token: existing?.sync_token ?? null, push_app_events: existing?.push_app_events ?? false, status: 'connected', last_error: null, updated_at: new Date().toISOString(),
  });
  return back(true);
}

async function syncCalendar(userId: string, conn: Record<string, any>) {
  const token = await accessToken(userId, conn);
  const tz = await userTz(userId);
  const calId = conn.selected_calendar_id as string | null;
  if (!calId) return { upserted: 0, removed: 0, pushed: 0, fullResync: false, partialFailures: 0 };
  let upserted = 0, removed = 0, pushed = 0, failures = 0, fullResync = false;
  let syncToken: string | null = conn.sync_token ?? null;
  let nextSyncToken: string | null = null;
  let rateLimited = false;

  const writeRow = async (googleId: string, row: Record<string, unknown> | null, cancelled: boolean) => {
    // An app-owned event already linked to this Google event, or our (possibly tombstoned) copy with the deterministic id.
    const copyId = await localEventId(calId, googleId);
    const { data: mine } = await admin.from('calendar_events').select('id, rev, origin, google_etag, deleted_at').eq('user_id', userId).eq('google_calendar_id', calId).eq('google_event_id', googleId).eq('origin', 'app').is('deleted_at', null).maybeSingle();
    const { data: copy } = mine ? { data: null } : await admin.from('calendar_events').select('id, rev, origin, google_etag, deleted_at').eq('user_id', userId).eq('id', copyId).maybeSingle();
    const existing = mine ?? copy;
    if (cancelled) {
      // A cancelled/removed Google event only removes OUR COPY (a tombstone). Nothing is ever deleted in Google.
      if (existing && existing.origin === 'google' && !existing.deleted_at) { await admin.from('calendar_events').update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString(), base_rev: existing.rev }).eq('user_id', userId).eq('id', existing.id); removed++; }
      return;
    }
    if (!row) return;
    if (existing) {
      if (existing.origin === 'app') { await admin.from('calendar_events').update({ google_etag: row.google_etag, base_rev: existing.rev }).eq('user_id', userId).eq('id', existing.id); return; } // app-owned: keep our content
      if (!existing.deleted_at && existing.google_etag && existing.google_etag === row.google_etag) return; // unchanged: no write, no loop
      await admin.from('calendar_events').update({ ...row, deleted_at: null, updated_at: new Date().toISOString(), base_rev: existing.rev }).eq('user_id', userId).eq('id', existing.id);
    } else {
      await admin.from('calendar_events').insert({ ...row, user_id: userId, id: await localEventId(calId, googleId), origin: 'google', category: 'other', google_calendar_id: calId, google_event_id: googleId, read_only: true, updated_at: new Date().toISOString(), base_rev: 0 });
    }
    upserted++;
  };

  for (let attempt = 0; attempt < 2; attempt++) {
    let pageToken: string | null = null;
    let expired = false;
    do {
      const q = new URLSearchParams({ singleEvents: 'true', showDeleted: 'true', maxResults: '250' });
      if (syncToken) q.set('syncToken', syncToken);
      else { q.set('timeMin', new Date(Date.now() - 90 * 86_400_000).toISOString()); }
      if (pageToken) q.set('pageToken', pageToken);
      const { res, body } = await googleFetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${q}`, {}, token);
      if (!res.ok) {
        const k = classifyGoogleError(res.status, body);
        if (k.kind === 'sync_token_expired') { expired = true; break; }
        if (k.kind === 'rate_limited') { rateLimited = true; break; }
        if (k.kind === 'token_revoked') throw Object.assign(new Error('needs_reconsent'), { code: 'needs_reconsent' });
        throw Object.assign(new Error('google_error'), { code: k.kind });
      }
      for (const g of body.items ?? []) {
        try { await writeRow(g.id, toAppEvent(g, tz), g.status === 'cancelled'); } catch { failures++; }
      }
      pageToken = body.nextPageToken ?? null;
      if (!pageToken) nextSyncToken = body.nextSyncToken ?? null;
    } while (pageToken);
    if (expired && attempt === 0) {
      // 410 GONE: the sync token is no longer valid. Drop it and re-read the calendar from scratch (dedupe by Google event id).
      syncToken = null; fullResync = true; continue;
    }
    break;
  }

  // Optional: send app-owned events to Google (create/update only; remote events are never deleted).
  if (conn.push_app_events && hasWriteScope(conn.scope) && !rateLimited) {
    const since = conn.last_synced_at ?? '1970-01-01T00:00:00Z';
    const { data: mine } = await admin.from('calendar_events').select('*').eq('user_id', userId).eq('origin', 'app').is('deleted_at', null).or(`google_event_id.is.null,updated_at.gt.${since}`).limit(100);
    for (const e of mine ?? []) {
      try {
        const body = toGoogleBody(e, tz);
        const url = e.google_event_id ? `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(e.google_calendar_id ?? calId)}/events/${encodeURIComponent(e.google_event_id)}` : `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`;
        const { res, body: out } = await googleFetch(url, { method: e.google_event_id ? 'PATCH' : 'POST', body: JSON.stringify(body) }, token);
        if (!res.ok) { failures++; if (classifyGoogleError(res.status, out).kind === 'rate_limited') break; continue; }
        await admin.from('calendar_events').update({ google_calendar_id: e.google_calendar_id ?? calId, google_event_id: out.id, google_etag: out.etag ?? null, base_rev: e.rev }).eq('user_id', userId).eq('id', e.id);
        pushed++;
      } catch { failures++; }
    }
  }

  await admin.from('google_calendar_connections').update({
    sync_token: failures === 0 && !rateLimited && nextSyncToken ? nextSyncToken : fullResync ? null : syncToken,
    last_synced_at: new Date().toISOString(), status: 'connected', last_error: rateLimited ? 'Google asked us to slow down. It will retry.' : failures ? `${failures} event(s) couldn't be synced.` : null, updated_at: new Date().toISOString(),
  }).eq('user_id', userId);
  return { upserted, removed, pushed, fullResync, partialFailures: failures, rateLimited };
}

Deno.serve(async (req) => {
  const url = new URL(req.url);
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsFor(req) });
  if (req.method === 'GET' && url.pathname.endsWith('/callback')) return callback(req, url);
  if (req.method !== 'POST') return fail(req, 405, 'method_not_allowed', 'Use POST.');

  const userId = await authenticate(req);
  if (!userId) return fail(req, 401, 'unauthenticated', 'Sign in again.');
  let input: Record<string, any> = {};
  try { input = await req.json(); } catch { return fail(req, 400, 'bad_request', 'Invalid request.'); }
  const action = String(input.action ?? '');

  try {
    if (action === 'status') {
      const c = await getConn(userId);
      return json(req, 200, { configured, connected: Boolean(c), status: c?.status, email: c?.google_email ?? null, calendarId: c?.selected_calendar_id ?? null, calendarName: c?.selected_calendar_name ?? null, pushAppEvents: c?.push_app_events ?? false, canWrite: c ? hasWriteScope(c.scope) : false, lastSyncedAt: c?.last_synced_at ?? null, lastError: c?.last_error ?? null });
    }
    if (!configured) return fail(req, 503, 'not_configured', 'Google Calendar is not set up on the server yet.');

    if (action === 'start') {
      const { verifier, challenge } = await pkcePair();
      const state = randomState();
      const returnTo = input.returnTo === 'native' ? 'native' : 'web';
      await admin.from('google_oauth_states').delete().lt('expires_at', new Date().toISOString());
      await admin.from('google_oauth_states').insert({ state_hash: await sha256Hex(state), user_id: userId, code_verifier: verifier, return_to: returnTo, expires_at: new Date(Date.now() + 10 * 60_000).toISOString() });
      return json(req, 200, { url: buildAuthUrl({ clientId: CLIENT_ID, redirectUri: REDIRECT_URI, state, challenge, write: input.write === true }) });
    }

    const conn = await getConn(userId);
    if (!conn) return fail(req, 409, 'not_connected', 'Connect Google Calendar first.');

    if (action === 'calendars') {
      const token = await accessToken(userId, conn);
      const { res, body } = await googleFetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader', {}, token);
      if (!res.ok) return fail(req, 502, classifyGoogleError(res.status, body).kind, 'Google could not list your calendars.');
      return json(req, 200, { calendars: (body.items ?? []).map((c: any) => ({ id: c.id, name: c.summaryOverride ?? c.summary ?? c.id, primary: c.primary === true, canWrite: c.accessRole === 'owner' })) });
    }
    if (action === 'select') {
      const id = String(input.calendarId ?? '');
      const token = await accessToken(userId, conn);
      const { res, body } = await googleFetch('https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader', {}, token);
      const found = res.ok ? (body.items ?? []).find((c: any) => c.id === id) : null;
      if (!found) return fail(req, 400, 'invalid_calendar', 'That calendar isn’t available to this Google account.');
      // Switching calendars removes only the app's COPIES of the previous calendar's events.
      await admin.from('calendar_events').update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('user_id', userId).eq('origin', 'google').neq('google_calendar_id', id).is('deleted_at', null);
      await admin.from('google_calendar_connections').update({ selected_calendar_id: id, selected_calendar_name: found.summaryOverride ?? found.summary ?? id, sync_token: null, updated_at: new Date().toISOString() }).eq('user_id', userId);
      return json(req, 200, { ok: true });
    }
    if (action === 'set-push') {
      const enabled = input.enabled === true;
      if (enabled && !hasWriteScope(conn.scope)) return json(req, 200, { ok: false, needsConsent: true });
      await admin.from('google_calendar_connections').update({ push_app_events: enabled, updated_at: new Date().toISOString() }).eq('user_id', userId);
      return json(req, 200, { ok: true });
    }
    if (action === 'sync') {
      if (conn.last_synced_at && Date.now() - Date.parse(conn.last_synced_at) < 5000) return json(req, 200, { upserted: 0, removed: 0, pushed: 0, fullResync: false, partialFailures: 0 });
      return json(req, 200, await syncCalendar(userId, conn));
    }
    if (action === 'disconnect') {
      if (input.confirm !== true) return fail(req, 400, 'confirmation_required', 'Confirm to disconnect Google Calendar.');
      try {
        const refresh = await decryptToken(conn.encrypted_refresh_token, ENC_KEY);
        await fetch('https://oauth2.googleapis.com/revoke', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ token: refresh }) });
      } catch { /* best effort: the stored token is deleted below either way */ }
      await admin.from('google_calendar_connections').delete().eq('user_id', userId);
      await admin.from('calendar_events').update({ deleted_at: new Date().toISOString(), updated_at: new Date().toISOString() }).eq('user_id', userId).eq('origin', 'google').is('deleted_at', null);
      return json(req, 200, { ok: true });
    }
    return fail(req, 400, 'unknown_action', 'Unknown action.');
  } catch (e) {
    const code = (e as { code?: string }).code ?? 'internal';
    if (code === 'needs_reconsent') return fail(req, 409, 'needs_reconsent', 'Google access expired or was revoked. Reconnect Google Calendar.');
    console.error('google-calendar error', action, code); // never log tokens or payloads
    return fail(req, 500, code, 'Google Calendar couldn’t complete that. Try again.');
  }
});
