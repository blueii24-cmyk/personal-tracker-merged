import { AI_CHAT_PATH, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/tracker/config';
import type { AiChatRequest, AiChatResponse, ApiError } from '@/tracker/types/api';
import { TrackerError, type TrackerErrorCode } from './errors';

export interface PostAiChatOptions {
  /** Supabase access token for the signed-in user. Supabase Auth is not wired up yet. */
  accessToken: string;
  signal?: AbortSignal;
  timeoutMs?: number;
}

const KNOWN_CODES: ReadonlySet<string> = new Set<TrackerErrorCode>([
  'UNAUTHENTICATED',
  'INVALID_REQUEST',
  'SESSION_NOT_FOUND',
  'RATE_LIMITED',
  'PROVIDER_UNAVAILABLE',
  'TOOL_VALIDATION_FAILED',
  'INTERNAL_ERROR',
]);

/**
 * Typed client for `POST /functions/v1/ai-chat` (see BLUEPRINT.md §8).
 * Used by a future Supabase-backed TrackerService; the demo service never calls it.
 * Only the browser-safe URL/publishable key and the user's own access token are sent —
 * provider API keys live in Edge Function secrets and never reach this code.
 */
export async function postAiChat(request: AiChatRequest, opts: PostAiChatOptions): Promise<AiChatResponse> {
  if (!SUPABASE_URL) throw new TrackerError('NOT_IMPLEMENTED', 'No backend is configured.', { retryable: false });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), opts.timeoutMs ?? 60_000);
  const onAbort = () => controller.abort();
  opts.signal?.addEventListener('abort', onAbort, { once: true });

  try {
    const res = await fetch(`${SUPABASE_URL}${AI_CHAT_PATH}`, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${opts.accessToken}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
      },
      body: JSON.stringify(request),
    });

    const body: unknown = await res.json().catch(() => null);
    if (!res.ok) throw parseApiError(body, res.status);
    return body as AiChatResponse;
  } catch (e) {
    if (e instanceof TrackerError) throw e;
    if (opts.signal?.aborted) throw new TrackerError('ABORTED', 'The request was cancelled.', { retryable: true });
    if (controller.signal.aborted) throw new TrackerError('NETWORK', 'The assistant took too long to respond.', { retryable: true });
    throw new TrackerError('NETWORK', "Couldn't reach the server. Check your connection and try again.", { retryable: true });
  } finally {
    clearTimeout(timeout);
    opts.signal?.removeEventListener('abort', onAbort);
  }
}

function parseApiError(body: unknown, status: number): TrackerError {
  const err = (body as Partial<ApiError> | null)?.error;
  if (err && typeof err.message === 'string') {
    const code = KNOWN_CODES.has(String(err.code)) ? (err.code as TrackerErrorCode) : 'INTERNAL_ERROR';
    return new TrackerError(code, err.message, { retryable: Boolean(err.retryable), requestId: err.requestId });
  }
  if (status === 401) return new TrackerError('UNAUTHENTICATED', 'Your session has expired. Sign in again.', { retryable: false });
  if (status === 429) return new TrackerError('RATE_LIMITED', 'Too many requests. Wait a moment and try again.', { retryable: true });
  return new TrackerError('INTERNAL_ERROR', 'The server returned an unexpected response.', { retryable: status >= 500 });
}
