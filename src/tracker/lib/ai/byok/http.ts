import { TrackerError } from '@/tracker/lib/api/errors';

export const DEFAULT_TIMEOUT_MS = 60_000;

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

function extractMessage(body: unknown): string | null {
  if (!body || typeof body !== 'object') return null;
  const b = body as Record<string, unknown>;
  const err = b.error;
  if (typeof err === 'string') return err;
  if (err && typeof err === 'object' && typeof (err as Record<string, unknown>).message === 'string') return (err as { message: string }).message;
  if (typeof b.message === 'string') return b.message;
  return null;
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
  const timeout = AbortSignal.timeout(req.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const signal = req.signal ? AbortSignal.any([req.signal, timeout]) : timeout;
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
    if (timeout.aborted) throw new TrackerError('NETWORK', `${req.providerLabel} took too long to answer. Try again.`, { retryable: true });
    const host = safeHost(req.url);
    throw new TrackerError(
      'NETWORK',
      `Couldn't reach ${host}. You may be offline, the address may be wrong, or the provider doesn't allow requests from a web page (CORS).`,
      { retryable: true },
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
    if (parsed == null) throw new TrackerError('PROVIDER_UNAVAILABLE', `${req.providerLabel} sent a reply that couldn't be read.`, { retryable: true, requestId });
    return { data: parsed as T, requestId };
  }

  const detail = redactKey(extractMessage(parsed) ?? rawText.slice(0, 200), req.apiKey).replace(/\s+/g, ' ').trim().slice(0, 300);
  const suffix = detail ? ` (${detail})` : '';
  switch (true) {
    case res.status === 401 || res.status === 403:
      throw new TrackerError('AI_KEY_REJECTED', `${req.providerLabel} didn't accept this API key or doesn't allow it to use this model${suffix}.`, { retryable: false, requestId });
    case res.status === 404 && req.notFoundMeansModel:
      throw new TrackerError('AI_MODEL_NOT_FOUND', `${req.providerLabel} doesn't know the model "${req.model}", or your key can't use it${suffix}.`, { retryable: false, requestId });
    case res.status === 404:
      throw new TrackerError('AI_MODEL_NOT_FOUND', `Nothing answered at that address. Check the base URL and the model name${suffix}.`, { retryable: false, requestId });
    case res.status === 408 || res.status === 429:
      throw new TrackerError('RATE_LIMITED', `${req.providerLabel} says you've hit a rate or usage limit${suffix}. Wait a moment and retry.`, { retryable: true, requestId });
    case res.status >= 500:
      throw new TrackerError('PROVIDER_UNAVAILABLE', `${req.providerLabel} is having trouble right now${suffix}.`, { retryable: true, requestId });
    default:
      throw new TrackerError('INVALID_REQUEST', `${req.providerLabel} rejected the request${suffix}.`, { retryable: false, requestId });
  }
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
