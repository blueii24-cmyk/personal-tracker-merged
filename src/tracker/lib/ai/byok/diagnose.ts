/**
 * Turns a failed provider response into a precise, secret-free diagnosis.
 * A 401 is not the only "bad key" signal (Gemini answers 400), and many failures that look like key problems are really
 * billing, region, permission, endpoint or model problems. Pure and unit-tested; nothing here touches the network.
 */
import type { TrackerErrorCode } from '@/tracker/lib/api/errors';

export interface Diagnosis {
  code: TrackerErrorCode;
  /** Stable, safe-to-show identifier such as `HTTP_401/KEY_INVALID`. */
  diagnostic: string;
  message: string;
  retryable: boolean;
}

/** Remove anything that looks like a credential, markup or an echoed key from provider text before it is shown. */
export function sanitizeDetail(text: string, apiKey = ''): string {
  let out = text
    .replace(/<[^>]*>/g, ' ')
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]{6,}/gi, 'Bearer [key]')
    .replace(/\b(sk-[A-Za-z0-9_-]{6,}|AIza[0-9A-Za-z_-]{10,}|gsk_[A-Za-z0-9]{10,}|xai-[A-Za-z0-9]{10,})/g, '[key]');
  const key = apiKey.trim();
  if (key.length >= 8) {
    out = out.split(key).join('[key]');
    for (let i = 0; i + 8 <= key.length; i += 4) out = out.split(key.slice(i, i + 8)).join('[key]');
  }
  return out.replace(/\s+/g, ' ').trim().slice(0, 200);
}

function field(v: unknown): string {
  return typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '';
}

/** Everything the provider says about the error, lower-cased, for keyword checks (never displayed as-is). */
export function errorSignals(body: unknown, rawText: string): string {
  const parts: string[] = [];
  if (body && typeof body === 'object') {
    const b = body as Record<string, unknown>;
    const e = b.error;
    if (typeof e === 'string') parts.push(e);
    else if (e && typeof e === 'object') {
      const o = e as Record<string, unknown>;
      parts.push(field(o.message), field(o.code), field(o.type), field(o.status), field(o.reason));
      if (Array.isArray(o.details)) for (const d of o.details) if (d && typeof d === 'object') parts.push(field((d as Record<string, unknown>).reason));
    }
    parts.push(field(b.message), field(b.detail), field(b.type));
  }
  if (!parts.some(Boolean)) parts.push(rawText.slice(0, 400));
  return parts.join(' ').toLowerCase();
}

export interface HttpFailure {
  status: number;
  body: unknown;
  rawText: string;
  providerLabel: string;
  model: string;
  notFoundMeansModel: boolean;
  apiKey: string;
  /** True for the "Other (OpenAI-compatible)" provider, where the address itself may be wrong. */
  custom?: boolean;
}

const QUOTA = /insufficient_quota|exceeded your current quota|billing|credit balance|out of credits|payment required|insufficient (credits|funds)|resource_exhausted.*quota|quota.*(exceeded|exhausted)|spend limit|usage limit reached/;
const REGION = /unsupported_country|country, region|region.*(not supported|unsupported)|not available in your (country|region)|location is not supported/;
const API_OFF = /service_disabled|has not been used in project|api.*(is )?disabled|accessnotconfigured/;
const BAD_KEY = /api_key_invalid|api key not valid|invalid api key|invalid_api_key|incorrect api key|invalid x-api-key|authentication_error|unauthorized|no auth credentials|invalid authentication|key.*(revoked|expired|disabled)/;
const MODEL_BAD = /model_not_found|model.*(not found|does not exist|not supported|is not available|unavailable|decommissioned|deprecated)|unknown model|invalid model|no such model|does not have access to model/;

const tag = (status: number, what: string) => `HTTP_${status}/${what}`;

export function classifyHttpFailure(f: HttpFailure): Diagnosis {
  const s = errorSignals(f.body, f.rawText);
  const detail = sanitizeDetail(
    (() => {
      const b = f.body as Record<string, unknown> | null;
      const e = b && typeof b === 'object' ? b.error : undefined;
      if (typeof e === 'string') return e;
      if (e && typeof e === 'object' && typeof (e as Record<string, unknown>).message === 'string') return (e as { message: string }).message;
      if (b && typeof b === 'object' && typeof b.message === 'string') return b.message;
      return f.rawText;
    })(),
    f.apiKey,
  );
  const suffix = detail ? ` Provider said: “${detail}”.` : '';
  const P = f.providerLabel;
  const mk = (code: TrackerErrorCode, what: string, message: string, retryable = false): Diagnosis => ({
    code,
    diagnostic: tag(f.status, what),
    message: `${message}${suffix}`,
    retryable,
  });

  // Billing and quota first: they arrive as 402/403/429 and must not be called "wrong key" or "retry in a moment".
  if (f.status === 402 || (QUOTA.test(s) && f.status !== 500)) {
    return mk('AI_QUOTA_EXCEEDED', 'QUOTA_EXCEEDED', `${P} says this account is out of credit or over its spending limit. The key itself is probably fine. Add credit or raise the limit with ${P}.`);
  }
  if (REGION.test(s)) {
    return mk('AI_PERMISSION_DENIED', 'REGION_BLOCKED', `${P} isn't available from this location or account region. The key isn't the problem.`);
  }
  if (API_OFF.test(s)) {
    return mk('AI_PERMISSION_DENIED', 'API_NOT_ENABLED', `${P} is switched off for this key's project. Enable the API for it in the provider's console.`);
  }
  if (f.status === 401 || (f.status === 400 && BAD_KEY.test(s)) || (f.status === 403 && BAD_KEY.test(s))) {
    return mk('AI_KEY_REJECTED', 'KEY_INVALID', `${P} didn't accept this API key. Copy the whole key again, check it hasn't been revoked, and that it belongs to ${P}.`);
  }
  if (f.status === 403) {
    const html = /<html|cloudflare|access denied/i.test(f.rawText);
    return html
      ? mk('AI_PERMISSION_DENIED', 'BLOCKED_BY_SERVER', `${f.custom ? 'That server' : P} blocked the request before it reached the API (a firewall or proxy page). Check the address and your network.`)
      : mk('AI_PERMISSION_DENIED', 'PERMISSION_DENIED', `${P} accepted the key but doesn't allow it to use this model or feature. Check the key's permissions and the model name.`);
  }
  if (f.status === 404) {
    return f.notFoundMeansModel || MODEL_BAD.test(s)
      ? mk('AI_MODEL_NOT_FOUND', 'MODEL_NOT_FOUND', `${P} doesn't know the model “${f.model}”, or this key can't use it. Pick another model.`)
      : mk('AI_ENDPOINT_ERROR', 'ENDPOINT_NOT_FOUND', 'Nothing answered at that address. Check the base URL (it usually ends in /v1) and the model name.');
  }
  if ((f.status === 400 || f.status === 422) && MODEL_BAD.test(s)) {
    return mk('AI_MODEL_NOT_FOUND', 'MODEL_UNSUPPORTED', `${P} can't use the model “${f.model}” for this request. Pick another model.`);
  }
  if (f.status === 429) return mk('RATE_LIMITED', 'RATE_LIMITED', `${P} is rate-limiting this key. Wait a moment and retry.`, true);
  if (f.status === 408 || f.status === 504 || f.status === 524) return mk('PROVIDER_UNAVAILABLE', 'PROVIDER_TIMEOUT', `${P} took too long to answer. Try again.`, true);
  if (f.status >= 500) return mk('PROVIDER_UNAVAILABLE', 'PROVIDER_ERROR', `${P} is having trouble right now. Try again shortly.`, true);
  return mk('INVALID_REQUEST', 'REQUEST_REJECTED', `${P} rejected the request.`);
}

/** Message suffix shown to the user: a short code that is safe to copy into a support request. */
export function withDiagnostic(message: string, diagnostic: string): string {
  return `${message} [${diagnostic}]`;
}
