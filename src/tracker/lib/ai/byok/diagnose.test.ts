import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackerError } from '@/tracker/lib/api/errors';
import { classifyHttpFailure, sanitizeDetail } from './diagnose';
import { postJson } from './http';

const KEY = 'sk-test-SECRETSECRET1234567890';

function mockFetch(status: number, body: unknown, headers: Record<string, string> = {}) {
  const text = typeof body === 'string' ? body : JSON.stringify(body);
  vi.stubGlobal('fetch', vi.fn(async () => new Response(text, { status, headers })));
}
const err = (p: Promise<unknown>): Promise<TrackerError> => p.then(() => { throw new Error('expected an error'); }, (x: unknown) => x as TrackerError);

async function fail(status: number, body: unknown, extra: Partial<Parameters<typeof postJson>[0]> = {}): Promise<TrackerError> {
  mockFetch(status, body);
  return err(postJson({ url: 'https://api.example.com/v1/x', headers: {}, body: {}, apiKey: KEY, providerLabel: 'OpenAI', notFoundMeansModel: true, model: 'm1', ...extra }));
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('provider failure diagnosis', () => {
  it('401 is a rejected key', async () => {
    const e = await fail(401, { error: { message: `Incorrect API key provided: ${KEY}` } });
    expect(e.code).toBe('AI_KEY_REJECTED');
    expect(e.diagnostic).toBe('HTTP_401/KEY_INVALID');
    expect(e.message).toContain("didn't accept this API key");
    expect(e.message).not.toContain('SECRETSECRET');
  });
  it('Gemini answers 400 API_KEY_INVALID for a bad key', async () => {
    const e = await fail(400, { error: { code: 400, message: 'API key not valid. Please pass a valid API key.', status: 'INVALID_ARGUMENT', details: [{ reason: 'API_KEY_INVALID' }] } }, { providerLabel: 'Google Gemini' });
    expect(e.code).toBe('AI_KEY_REJECTED');
  });
  it('403 permission is NOT called a wrong key', async () => {
    const e = await fail(403, { error: { message: 'Project does not have access to this model' } });
    expect(e.code).toBe('AI_PERMISSION_DENIED');
    expect(e.message).not.toMatch(/didn't accept this API key/);
  });
  it('403 region block and disabled API are distinct', async () => {
    expect((await fail(403, { error: { code: 'unsupported_country_region_territory', message: 'Country, region, or territory not supported' } })).diagnostic).toBe('HTTP_403/REGION_BLOCKED');
    expect((await fail(403, { error: { status: 'PERMISSION_DENIED', details: [{ reason: 'SERVICE_DISABLED' }], message: 'API has not been used in project 123' } })).diagnostic).toBe('HTTP_403/API_NOT_ENABLED');
  });
  it('404 is a model problem for first-party providers and an address problem for custom servers', async () => {
    expect((await fail(404, { error: { message: 'The model `x` does not exist' } })).code).toBe('AI_MODEL_NOT_FOUND');
    const c = await fail(404, 'not found', { notFoundMeansModel: false, providerLabel: 'The model server' });
    expect(c.code).toBe('AI_ENDPOINT_ERROR');
    expect(c.message).toContain('base URL');
  });
  it('400 model errors are model problems', async () => {
    expect((await fail(400, { error: { code: 'model_not_found', message: 'model not found' } })).code).toBe('AI_MODEL_NOT_FOUND');
  });
  it('429 insufficient_quota is billing, plain 429 is a retryable rate limit', async () => {
    const q = await fail(429, { error: { code: 'insufficient_quota', message: 'You exceeded your current quota' } });
    expect(q.code).toBe('AI_QUOTA_EXCEEDED');
    expect(q.retryable).toBe(false);
    const r = await fail(429, { error: { message: 'Too many requests' } });
    expect(r.code).toBe('RATE_LIMITED');
    expect(r.retryable).toBe(true);
  });
  it('Anthropic low credit balance (400) is billing', async () => {
    const e = await fail(400, { type: 'error', error: { type: 'invalid_request_error', message: 'Your credit balance is too low to access the Anthropic API.' } }, { providerLabel: 'Anthropic' });
    expect(e.code).toBe('AI_QUOTA_EXCEEDED');
  });
  it('5xx is retryable provider trouble; custom-server HTML 403 is a blocked address', async () => {
    expect((await fail(503, 'down')).code).toBe('PROVIDER_UNAVAILABLE');
    const e = await fail(403, '<html>Access denied by Cloudflare</html>', { providerLabel: 'The model server', notFoundMeansModel: false });
    expect(e.diagnostic).toBe('HTTP_403/BLOCKED_BY_SERVER');
  });
  it('a CORS/network failure never mentions the key being wrong', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    const e = await err(postJson({ url: 'https://api.example.com/v1/x', headers: {}, body: {}, apiKey: KEY, providerLabel: 'OpenAI', notFoundMeansModel: true, model: 'm' }));
    expect(e.code).toBe('NETWORK');
    expect(e.diagnostic).toBe('NETWORK_OR_CORS');
    expect(e.message).toContain('does not establish whether your key is valid');
  });
  it('a timeout is reported as a timeout (also with the Android AbortSignal fallbacks)', async () => {
    const t = AbortSignal.timeout;
    const a = AbortSignal.any;
    // @ts-expect-error simulate an old WebView without these APIs
    delete AbortSignal.timeout;
    // @ts-expect-error simulate an old WebView without these APIs
    delete AbortSignal.any;
    try {
      vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))))));
      const e = await err(postJson({ url: 'https://api.example.com/v1/x', headers: {}, body: {}, apiKey: KEY, providerLabel: 'OpenAI', notFoundMeansModel: true, model: 'm', timeoutMs: 20, signal: new AbortController().signal }));
      expect(e.diagnostic).toBe('TIMEOUT');
    } finally {
      AbortSignal.timeout = t;
      AbortSignal.any = a;
    }
  });
  it('a user abort is ABORTED, not an error to blame on the provider', async () => {
    const ctl = new AbortController();
    vi.stubGlobal('fetch', vi.fn((_u: string, init: RequestInit) => new Promise((_r, rej) => init.signal!.addEventListener('abort', () => rej(new DOMException('x', 'AbortError'))))));
    const p = err(postJson({ url: 'https://api.example.com/v1/x', headers: {}, body: {}, apiKey: KEY, providerLabel: 'OpenAI', notFoundMeansModel: true, model: 'm', signal: ctl.signal }));
    ctl.abort();
    expect((await p).code).toBe('ABORTED');
  });
  it('a malformed 200 reply is a bad-response error, and an HTML page is called out', async () => {
    mockFetch(200, '<html>login</html>');
    const e = await err(postJson({ url: 'https://x.example.com/v1/c', headers: {}, body: {}, apiKey: KEY, providerLabel: 'The model server', notFoundMeansModel: false, model: 'm' }));
    expect(e.diagnostic).toBe('BAD_RESPONSE');
    expect(e.message).toContain('web page');
  });
  it('offline fails fast with an OFFLINE diagnostic', async () => {
    vi.stubGlobal('navigator', { onLine: false });
    const e = await err(postJson({ url: 'https://x.example.com', headers: {}, body: {}, apiKey: KEY, providerLabel: 'OpenAI', notFoundMeansModel: true, model: 'm' }));
    expect(e.diagnostic).toBe('OFFLINE');
  });
});

describe('redaction', () => {
  it('removes the key, bearer tokens, key-shaped strings and markup', () => {
    const out = sanitizeDetail(`<b>bad</b> Authorization: Bearer abcdef123456 key ${KEY} also AIzaSyA1234567890abcdefg and sk-ant-api03-abcdefghij`, KEY);
    expect(out).not.toMatch(/SECRETSECRET|abcdef123456|AIzaSy|sk-ant-api03|<b>/);
  });
  it('classifier never returns the key even when the provider echoes it', () => {
    const d = classifyHttpFailure({ status: 401, body: { error: { message: `bad key ${KEY}` } }, rawText: '', providerLabel: 'OpenAI', model: 'm', notFoundMeansModel: true, apiKey: KEY });
    expect(JSON.stringify(d)).not.toContain('SECRETSECRET');
  });
});
