/**
 * Browser side of the optional Google Calendar connection. Everything sensitive (client secret, refresh token, token
 * refresh, Google API calls) happens in the `google-calendar` Supabase Edge Function. The browser only ever sends the
 * user's own Supabase session and receives status, calendar names and an authorisation URL; it never sees a Google token.
 */
import { TrackerError } from '@/tracker/lib/api/errors';
import { getSupabase } from '@/tracker/lib/supabase/client';
import { isNative } from '@/tracker/lib/platform/native';

export interface GoogleStatus {
  /** The server has Google credentials configured. */
  configured: boolean;
  connected: boolean;
  status?: 'connected' | 'needs_reconsent' | 'error';
  email?: string | null;
  calendarId?: string | null;
  calendarName?: string | null;
  pushAppEvents?: boolean;
  /** The granted scopes allow creating/updating events. */
  canWrite?: boolean;
  lastSyncedAt?: string | null;
  lastError?: string | null;
}
export interface GoogleCalendarInfo { id: string; name: string; primary: boolean; canWrite: boolean }
export interface GoogleSyncResult { upserted: number; removed: number; pushed: number; fullResync: boolean; partialFailures: number }

interface FnErrorBody { error?: { code?: string; message?: string } }

export async function callGoogle<T>(action: string, body: Record<string, unknown> = {}): Promise<T> {
  const sb = getSupabase();
  if (!sb) throw new TrackerError('NOT_CONFIGURED', 'Cloud sync isn’t set up in this build, so Google Calendar can’t be connected.', { retryable: false });
  if (typeof navigator !== 'undefined' && navigator.onLine === false) throw new TrackerError('NETWORK', 'You’re offline. Reconnect to use Google Calendar.', { retryable: true });
  const { data, error } = await sb.functions.invoke('google-calendar', { body: { action, ...body } });
  if (!error) return data as T;
  const ctx = (error as { context?: Response }).context;
  if (ctx && typeof ctx.status === 'number') {
    let parsed: FnErrorBody | null = null;
    try {
      parsed = (await ctx.clone().json()) as FnErrorBody;
    } catch {
      parsed = null;
    }
    if (ctx.status === 404) throw new TrackerError('NOT_CONFIGURED', 'Google Calendar isn’t deployed on the server yet (the google-calendar function was not found).', { retryable: false, diagnostic: 'FUNCTION_NOT_FOUND', status: 404 });
    if (ctx.status === 401) throw new TrackerError('UNAUTHENTICATED', 'Your session has expired. Sign in again.', { retryable: false, status: 401 });
    const code = parsed?.error?.code ?? `HTTP_${ctx.status}`;
    const msg = parsed?.error?.message ?? 'Google Calendar couldn’t complete that. Try again in a moment.';
    throw new TrackerError(ctx.status === 429 ? 'RATE_LIMITED' : 'INTERNAL_ERROR', msg, { retryable: ctx.status >= 500 || ctx.status === 429, diagnostic: code, status: ctx.status });
  }
  throw new TrackerError('NETWORK', 'Couldn’t reach the sync service. Check your connection and try again.', { retryable: true, diagnostic: 'NETWORK' });
}

/** Opens Google's consent page in the system browser (Chrome Custom Tab on Android), never inside the app's own WebView. */
export async function openConsent(url: string): Promise<void> {
  const u = new URL(url);
  if (u.protocol !== 'https:' || u.hostname !== 'accounts.google.com') throw new TrackerError('INVALID_REQUEST', 'Unexpected authorisation address.', { retryable: false });
  if (isNative()) {
    const { Browser } = await import('@capacitor/browser');
    await Browser.open({ url });
  } else {
    window.location.assign(url);
  }
}
