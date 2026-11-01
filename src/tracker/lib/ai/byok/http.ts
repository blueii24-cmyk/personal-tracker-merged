import { TrackerError } from '@/tracker/lib/api/errors';
import { classifyHttpFailure, withDiagnostic } from './diagnose';

export const DEFAULT_TIMEOUT_MS = 60_000;

/** `AbortSignal.timeout` with a fallback for Android WebViews older than Chrome 124. */
function timeoutSignal(ms: number): AbortSignal {
  if (typeof AbortSignal.timeout === 'function') return AbortSignal.timeout(ms);
  const ctl = new AbortController();
  setTimeout(() => ctl.abort(new DOMException('The operation timed out.', 'TimeoutError')), ms);
  return ctl.signal;
}
/** `AbortSignal.any` with a fallback for Android WebViews older than Chrome 116. */
function anySignal(signals: AbortSignal[]): AbortSignal {
  if (typeof AbortSignal.any === 'function') return AbortSignal.any(signals);
  const ctl = new AbortController();
  for (const s of signals) {
    if (s.aborted) {
      ctl.abort(s.reason);
      break;
    }
    s.addEventListener('abort', () => ctl.abort(s.reason), { once: true });
  }
  return ctl.signal;
}

/** Remove the key (and any long fragment of it) from text that may be shown to the user. */
export function redactKey(text: string, apiKey: string): string {
  let out = text;
  const key = apiKey.trim();
  if (key.length >= 8) {
    out = out.split(key).join('[key]');
    // Providers sometimes echo a masked key such as "sk-abc...xyz"; hide any 8+ char run of the key too.
    for (let i = 0; i + 8 <= key.length; i += 4) out = out.split(key.slice(i, i + 8)).join('[key]');
  }
  return out;
}

export interface JsonRequest {
  url: string;
  headers: Record<string, string>;
  /** Omit for GET requests. */
  body?: unknown;
  method?: 'GET' | 'POST';
  apiKey: string;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Shown in error messages, e.g. "OpenAI". */
  providerLabel: string;
  /** When true a 404 means the model id is wrong rather than the address. */
  notFoundMeansModel: boolean;
  model: string;
}

/** POST JSON and map every failure to a `TrackerError` with a plain-language message that never contains the key. */
export async function postJson<T>(req: JsonRequest): Promise<{ data: T; requestId?: string }> {
  // Fail fast and clearly when the device has no connection, instead of waiting out the timeout.
  if (typeof navigator !== 'undefined' && navigator.onLine === false) {
    throw new TrackerError('NETWORK', `You're offline, so ${req.providerLabel} can't be reached. Your records are safe on this device. Reconnect and try again.`, { retryable: true, diagnostic: 'OFFLINE' });
  }
  const timeout = timeoutSignal(req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = req.signal ? anySignal([req.signal, timeout]) : timeout;
  let res: Response;
  try {
    const isGet = req.method === 'GET';
    res = await fetch(req.url, {
      method: isGet ? 'GET' : 'POST',
      headers: isGet ? { ...req.headers } : { 'content-type': 'application/json', ...req.headers },
      ...(isGet ? {} : { body: JSON.stringify(req.body) }),
      signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (e) {
    if (req.signal?.aborted) throw new TrackerError('ABORTED', 'The request was cancelled.', { retryable: true });
    if (timeout.aborted) throw new TrackerError('NETWORK', withDiagnostic(`${req.providerLabel} took too long to answer. Try again, or pick a faster model.`, 'TIMEOUT'), { retryable: true, diagnostic: 'TIMEOUT' });
    const host = safeHost(req.url);
    throw new TrackerError(
      'NETWORK',
      withDiagnostic(
        `Couldn't reach ${host}. This is a connection problem, not a key problem: you may be offline, the address may be wrong, or the provider doesn't allow requests from a web page (CORS).`,
        'NETWORK_OR_CORS',
      ),
      { retryable: true, diagnostic: 'NETWORK_OR_CORS' },
    );
  }

  const requestId = res.headers.get('x-request-id') ?? res.headers.get('request-id') ?? undefined;
  let parsed: unknown = null;
  let rawText = '';
  try {
    rawText = await res.text();
    parsed = rawText ? JSON.parse(rawText) : null;
  } catch {
    parsed = null;
  }

  if (res.ok) {
    if (parsed == null) throw new TrackerError(
        'PROVIDER_UNAVAILABLE',
        withDiagnostic(`${req.providerLabel} answered, but not in the format this app expects${rawText.trim().startsWith('<') ? ' (it returned a web page, so the address is probably not an API)' : ''}.`, 'BAD_RESPONSE'),
        { retryable: true, requestId, diagnostic: 'BAD_RESPONSE', status: res.status },
      );
    return { data: parsed as T, requestId };
  }

  const d = classifyHttpFailure({
    status: res.status,
    body: parsed,
    rawText,
    providerLabel: req.providerLabel,
    model: req.model,
    notFoundMeansModel: req.notFoundMeansModel,
    apiKey: req.apiKey,
    custom: req.providerLabel === 'The model server',
  });
  throw new TrackerError(d.code, withDiagnostic(d.message, d.diagnostic), { retryable: d.retryable, requestId, diagnostic: d.diagnostic, status: res.status });
}

/** GET JSON with the same error mapping and key redaction as `postJson`. */
export function getJson<T>(req: Omit<JsonRequest, 'method' | 'body' | 'model' | 'notFoundMeansModel'>): Promise<{ data: T; requestId?: string }> {
  return postJson<T>({ ...req, method: 'GET', notFoundMeansModel: false, model: '' });
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'the provider';
  }
}

/** Parse a tool-call argument string. Invalid JSON is flagged so the runner can ask the model to retry. */
export const INVALID_ARGS = '__invalid_arguments__';
export function parseArgs(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw as Record<string, unknown>;
  if (typeof raw !== 'string' || raw.trim() === '') return {};
  try {
    const v = JSON.parse(raw);
    return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : { [INVALID_ARGS]: 'Arguments must be a JSON object.' };
  } catch {
    return { [INVALID_ARGS]: 'Arguments were not valid JSON.' };
  }
}
