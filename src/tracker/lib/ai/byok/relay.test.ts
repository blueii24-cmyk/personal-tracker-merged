import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROXY_MARK, PROXY_TARGET_HEADER } from './bridged-hosts';
import { createProxyHandler } from './proxy-handler';
import { aiFetch } from './transport';

afterEach(() => vi.unstubAllGlobals());

const target = 'https://integrate.api.nvidia.com/v1';
const signal = () => new AbortController().signal;

function request(overrides: {
  method?: string;
  target?: string | null;
  origin?: string;
  body?: string;
} = {}): Request {
  const headers = new Headers({ host: 'localhost:3000' });
  if (overrides.target !== null) headers.set(PROXY_TARGET_HEADER, overrides.target ?? `${target}/models`);
  if (overrides.origin) headers.set('origin', overrides.origin);
  headers.set('authorization', 'Bearer test-key');
  headers.set('x-unforwarded', 'must-not-leak');
  return new Request('http://localhost:3000/api/ai-proxy', {
    method: overrides.method ?? 'GET',
    headers,
    body: overrides.body,
  });
}

describe('AI relay', () => {
  it('forwards only an allowed target and required headers', async () => {
    const upstream = vi.fn(async () => new Response('{"data":[]}', { status: 200 }));
    const response = await createProxyHandler(upstream as unknown as typeof fetch)(request());
    expect(response.status).toBe(200);
    expect(response.headers.get(PROXY_MARK)).toBe('1');
    const [url, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(`${target}/models`);
    expect(init.redirect).toBe('manual');
    expect(init.cache).toBe('no-store');
    expect(Object.keys(init.headers as Record<string, string>).sort()).toEqual(['accept', 'authorization']);
  });

  it.each([
    ['untrusted host', { target: 'https://evil.example/v1/models' }, 400],
    ['look-alike host', { target: 'https://integrate.api.nvidia.com.evil.example/v1/models' }, 400],
    ['http target', { target: 'http://integrate.api.nvidia.com/v1/models' }, 400],
    ['wrong path', { target: `${target}/files` }, 400],
    ['missing target', { target: null }, 400],
    ['untrusted origin', { origin: 'https://evil.example' }, 403],
    ['unsupported method', { method: 'DELETE' }, 405],
  ])('rejects %s', async (_label, overrides, status) => {
    const upstream = vi.fn();
    const response = await createProxyHandler(upstream as unknown as typeof fetch)(request(overrides));
    expect(response.status).toBe(status);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('forwards OpenRouter model discovery through the allow-listed relay', async () => {
    const upstream = vi.fn(async () => new Response('{"data":[]}', { status: 200 }));
    const url = 'https://openrouter.ai/api/v1/models';
    const response = await createProxyHandler(upstream as unknown as typeof fetch)(request({ target: url }));
    expect(response.status).toBe(200);
    expect(response.headers.get(PROXY_MARK)).toBe('1');
    const [forwardedUrl, init] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(forwardedUrl).toBe(url);
    expect(forwardedUrl).not.toContain('test-key');
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer test-key');
  });

  it('returns a safe 502 when the provider cannot be reached', async () => {
    const response = await createProxyHandler(async () => {
      throw new Error('provider failure');
    })(request());
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain('test-key');
  });
});

describe('AI transport', () => {
  it.each([
    `${target}/models`,
    'https://openrouter.ai/api/v1/models',
  ])('relays bridged model discovery in the browser: %s', async (url) => {
    const fetchImpl = vi.fn(async () => new Response('{}', { headers: { [PROXY_MARK]: '1' } }));
    const result = await aiFetch(url, {
      method: 'GET',
      headers: { authorization: 'Bearer test-key' },
      signal: signal(),
    }, { native: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.viaRelay).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith('/api/ai-proxy', expect.objectContaining({
      headers: expect.objectContaining({ [PROXY_TARGET_HEADER]: url }),
      credentials: 'same-origin',
      cache: 'no-store',
    }));
  });

  it('does not send browser credentials to a direct provider', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    await aiFetch('https://api.openai.com/v1/models', {
      method: 'GET',
      headers: { authorization: 'Bearer test-key' },
      signal: signal(),
    }, { native: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledWith('https://api.openai.com/v1/models', expect.objectContaining({
      credentials: 'omit',
    }));
  });

  it('uses the native client for bridged hosts on Android', async () => {
    const nativeRequest = vi.fn(async () => ({ status: 200, data: { data: [] }, headers: {} }));
    const fetchImpl = vi.fn();
    const result = await aiFetch(`${target}/chat/completions`, {
      method: 'POST',
      headers: { authorization: 'Bearer test-key' },
      body: '{"model":"test"}',
      signal: signal(),
    }, { native: true, fetchImpl: fetchImpl as unknown as typeof fetch, nativeRequest });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(nativeRequest).toHaveBeenCalledWith(expect.objectContaining({
      url: `${target}/chat/completions`,
      data: { model: 'test' },
    }));
    expect(await result.res.json()).toEqual({ data: [] });
  });

  it('uses the native client for OpenRouter model discovery on Android', async () => {
    const nativeRequest = vi.fn(async () => ({ status: 200, data: { data: [] }, headers: {} }));
    const fetchImpl = vi.fn();
    const url = 'https://openrouter.ai/api/v1/models';
    const result = await aiFetch(url, {
      method: 'GET',
      headers: { authorization: 'Bearer test-key' },
      signal: signal(),
    }, { native: true, fetchImpl: fetchImpl as unknown as typeof fetch, nativeRequest });
    expect(result.viaRelay).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(nativeRequest).toHaveBeenCalledWith(expect.objectContaining({ url, method: 'GET' }));
    expect(await result.res.json()).toEqual({ data: [] });
  });
});
