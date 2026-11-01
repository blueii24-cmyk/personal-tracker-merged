/**
 * Pure helpers for the google-calendar Edge Function (no Deno or network APIs), so they can be unit-tested with Vitest.
 * Scopes are the narrowest that do the job (verified against Google's OAuth scope list):
 *   read:  calendar.calendarlist.readonly (pick a calendar) + calendar.events.readonly (read its events)
 *   write: calendar.events.owned (create/change events on calendars the user OWNS), requested ONLY if the user opts in.
 */
export const SCOPE_CALENDAR_LIST = 'https://www.googleapis.com/auth/calendar.calendarlist.readonly';
export const SCOPE_EVENTS_READ = 'https://www.googleapis.com/auth/calendar.events.readonly';
export const SCOPE_EVENTS_WRITE = 'https://www.googleapis.com/auth/calendar.events.owned';
export const READ_SCOPES = [SCOPE_CALENDAR_LIST, SCOPE_EVENTS_READ];

/** Revision-aware tombstone for an imported copy; never sent to Google and never applied to app-owned events. */
export const googleCopyTombstone = (baseRev: number, at: string) => ({ deleted_at: at, updated_at: at, base_rev: baseRev });

export const b64 = (bytes: Uint8Array): string => btoa(String.fromCharCode(...bytes));
export const unb64 = (s: string): Uint8Array => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
export const b64url = (bytes: Uint8Array): string => b64(bytes).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

export async function sha256Hex(text: string): Promise<string> {
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(d)].map((x) => x.toString(16).padStart(2, '0')).join('');
}

/** PKCE (RFC 7636) verifier + S256 challenge. */
export async function pkcePair(): Promise<{ verifier: string; challenge: string }> {
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(32)));
  const d = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
  return { verifier, challenge: b64url(new Uint8Array(d)) };
}
export const randomState = (): string => b64url(crypto.getRandomValues(new Uint8Array(32)));

export function buildAuthUrl(p: { clientId: string; redirectUri: string; state: string; challenge: string; write: boolean }): string {
  const scopes = p.write ? [...READ_SCOPES, SCOPE_EVENTS_WRITE] : READ_SCOPES;
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', p.clientId);
  u.searchParams.set('redirect_uri', p.redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', scopes.join(' '));
  u.searchParams.set('state', p.state);
  u.searchParams.set('code_challenge', p.challenge);
  u.searchParams.set('code_challenge_method', 'S256');
  u.searchParams.set('access_type', 'offline'); // needed to receive a refresh token
  u.searchParams.set('prompt', 'consent');
  u.searchParams.set('include_granted_scopes', 'true');
  return u.toString();
}

/* ---- token encryption at rest (AES-256-GCM; the key lives only in the function's secrets) ---- */
async function aesKey(keyB64: string, usage: KeyUsage[]): Promise<CryptoKey> {
  const raw = unb64(keyB64);
  if (raw.length !== 32) throw new Error('GOOGLE_TOKEN_ENC_KEY must be 32 bytes, base64 encoded');
  return crypto.subtle.importKey('raw', raw as BufferSource, 'AES-GCM', false, usage);
}
export async function encryptToken(plain: string, keyB64: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: iv as BufferSource }, await aesKey(keyB64, ['encrypt']), new TextEncoder().encode(plain));
  return `v1.${b64(iv)}.${b64(new Uint8Array(ct))}`;
}
export async function decryptToken(blob: string, keyB64: string): Promise<string> {
  const [v, iv, ct] = blob.split('.');
  if (v !== 'v1' || !iv || !ct) throw new Error('unsupported token format');
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) as BufferSource }, await aesKey(keyB64, ['decrypt']), unb64(ct) as BufferSource);
  return new TextDecoder().decode(pt);
}

/* ---- mapping ---- */
export interface GoogleEvent {
  id?: string;
  status?: string;
  etag?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: { date?: string; dateTime?: string; timeZone?: string };
  end?: { date?: string; dateTime?: string; timeZone?: string };
}
const ymd = (d: Date): string => d.toISOString().slice(0, 10);
export const addDaysKey = (key: string, n: number): string => ymd(new Date(Date.parse(`${key}T00:00:00Z`) + n * 86_400_000));

export function dateKeyInZone(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(iso));
  const g = (t: string) => parts.find((p) => p.type === t)!.value;
  return `${g('year')}-${g('month')}-${g('day')}`;
}

/** Stable local id for a Google event: the same event always maps to the same row (no duplicate copies). */
export async function localEventId(calendarId: string, eventId: string): Promise<string> {
  return `g-${(await sha256Hex(`${calendarId}|${eventId}`)).slice(0, 32)}`;
}

export interface AppEventRow {
  title: string;
  notes: string | null;
  location: string | null;
  all_day: boolean;
  start_date: string;
  end_date: string;
  starts_at: string | null;
  ends_at: string | null;
  google_etag: string | null;
}
/** Google → app row. Returns null for events that can't be represented (and for cancelled ones, which are handled as deletions). */
export function toAppEvent(g: GoogleEvent, userTz: string): AppEventRow | null {
  if (!g.id || g.status === 'cancelled' || !g.start || !g.end) return null;
  const title = (g.summary ?? '').trim() || '(No title)';
  const base = { title: title.slice(0, 200), notes: g.description ? g.description.slice(0, 4000) : null, location: g.location ? g.location.slice(0, 300) : null, google_etag: g.etag ?? null };
  if (g.start.date) {
    const start = g.start.date;
    const endExclusive = g.end.date ?? addDaysKey(start, 1);
    const end = addDaysKey(endExclusive, -1); // Google's all-day end is exclusive
    return { ...base, all_day: true, start_date: start, end_date: end < start ? start : end, starts_at: null, ends_at: null };
  }
  if (!g.start.dateTime || !g.end.dateTime) return null;
  const s = new Date(g.start.dateTime);
  const e = new Date(g.end.dateTime);
  if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) return null;
  const startsAt = s.toISOString();
  const endsAt = (e < s ? s : e).toISOString();
  return { ...base, all_day: false, start_date: dateKeyInZone(startsAt, userTz), end_date: dateKeyInZone(endsAt, userTz), starts_at: startsAt, ends_at: endsAt };
}

export interface AppEventForPush { title: string; notes: string | null; location: string | null; all_day: boolean; start_date: string; end_date: string; starts_at: string | null; ends_at: string | null }
/** App event → Google request body. */
export function toGoogleBody(e: AppEventForPush, tz: string): Record<string, unknown> {
  const body: Record<string, unknown> = { summary: e.title, ...(e.notes ? { description: e.notes } : {}), ...(e.location ? { location: e.location } : {}) };
  if (e.all_day) {
    body.start = { date: e.start_date };
    body.end = { date: addDaysKey(e.end_date, 1) };
  } else {
    body.start = { dateTime: e.starts_at, timeZone: tz };
    body.end = { dateTime: e.ends_at, timeZone: tz };
  }
  return body;
}

export type GoogleFailure = 'token_revoked' | 'sync_token_expired' | 'rate_limited' | 'forbidden' | 'not_found' | 'unavailable' | 'invalid';
/** Classify a Google API failure so the function can recover (re-consent, full resync, back off) instead of just failing. */
export function classifyGoogleError(status: number, body: unknown): { kind: GoogleFailure; retryable: boolean } {
  const text = JSON.stringify(body ?? '').toLowerCase();
  if (status === 410) return { kind: 'sync_token_expired', retryable: true };
  if (status === 401 || /invalid_grant|token has been expired or revoked/.test(text)) return { kind: 'token_revoked', retryable: false };
  if (status === 429 || (status === 403 && /ratelimitexceeded|userratelimitexceeded|quotaexceeded/.test(text))) return { kind: 'rate_limited', retryable: true };
  if (status === 403) return { kind: 'forbidden', retryable: false };
  if (status === 404) return { kind: 'not_found', retryable: false };
  if (status >= 500) return { kind: 'unavailable', retryable: true };
  return { kind: 'invalid', retryable: false };
}

export function hasWriteScope(scope: string | null | undefined): boolean {
  return (scope ?? '').split(/\s+/).some((s) => s === SCOPE_EVENTS_WRITE || s === 'https://www.googleapis.com/auth/calendar.events' || s === 'https://www.googleapis.com/auth/calendar');
}

/** Only these origins may receive the browser redirect after consent (prevents an open redirect). */
export function allowedReturn(url: string | null, allowed: string[]): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return allowed.includes(u.origin) ? u.toString() : null;
  } catch {
    return null;
  }
}
