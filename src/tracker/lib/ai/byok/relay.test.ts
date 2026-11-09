import { afterEach, describe, expect, it, vi } from 'vitest';
import { PROXY_ERROR, PROXY_MARK, PROXY_TARGET_HEADER } from './bridged-hosts';
import { getJson } from './http';
import { createProxyHandler } from './proxy-handler';
import { aiFetch } from './transport';
import { createLlmProxyHandler } from './llm-proxy-handler';
import { LLM_PROXY_PATH, llmFetch } from './llm-fetch';

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
  it('relays OpenRouter model discovery with the existing transport', async () => {
    const url = 'https://openrouter.ai/api/v1/models';
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

function envelope(payload: unknown, origin = 'http://localhost:3000'): Request {
  return new Request('http://localhost:3000/api/llm-proxy', {
    method: 'POST', headers: { host: 'localhost:3000', origin, 'content-type': 'application/json' }, body: JSON.stringify(payload),
  });
}

describe('same-origin LLM proxy', () => {
  const modelsUrl = `${target}/models`;
  const chatUrl = `${target}/chat/completions`;

  it('connects web NVIDIA discovery through the envelope to the upstream and returns its data', async () => {
    const upstream = vi.fn(async () => new Response('{"data":[{"id":"example/model"}]}', { status: 200 }));
    const handler = createLlmProxyHandler(upstream as unknown as typeof fetch);
    const relayFetch = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(LLM_PROXY_PATH);
      return handler(new Request('http://localhost:3000/api/llm-proxy', { ...init, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), host: 'localhost:3000', origin: 'http://localhost:3000' } }));
    });
    const out = await aiFetch(modelsUrl, { method: 'GET', headers: { authorization: 'Bearer test-key' }, signal: signal() }, { native: false, fetchImpl: relayFetch as unknown as typeof fetch });
    expect(out.viaRelay).toBe(true);
    expect(out.res.headers.get(PROXY_MARK)).toBe('1');
    expect(await out.res.json()).toEqual({ data: [{ id: 'example/model' }] });
    const [url, options] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(modelsUrl);
    expect(options).toMatchObject({ method: 'GET', redirect: 'manual', headers: { authorization: 'Bearer test-key' } });
  });

  it('passes chat JSON and streams upstream chunks without exposing arbitrary request headers', async () => {
    const upstream = vi.fn(async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('data: one\n\n'));
        controller.enqueue(new TextEncoder().encode('data: two\n\n'));
        controller.close();
      },
    }), { headers: { 'content-type': 'text/event-stream' } }));
    const res = await createLlmProxyHandler(upstream as unknown as typeof fetch)(envelope({ url: chatUrl, method: 'POST', headers: { Authorization: 'Bearer test-key', cookie: 'do-not-forward' }, body: { model: 'example', stream: true } }));
    expect(res.headers.get('content-type')).toBe('text/event-stream');
    expect(await res.text()).toBe('data: one\n\ndata: two\n\n');
    const [, options] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(options.body).toBe('{"model":"example","stream":true}');
    expect(options.headers).toEqual({ accept: 'application/json, text/event-stream', authorization: 'Bearer test-key', 'content-type': 'application/json' });
  });

  it.each([
    ['lookalike host', { url: 'https://integrate.api.nvidia.com.evil.example/v1/models' }, 403],
    ['http', { url: 'http://integrate.api.nvidia.com/v1/models' }, 400],
    ['credentials in URL', { url: 'https://u:p@integrate.api.nvidia.com/v1/models' }, 400],
    ['non-standard port', { url: 'https://integrate.api.nvidia.com:8443/v1/models' }, 400],
    ['unapproved path', { url: `${target}/files` }, 403],
    ['cross-provider path', { url: 'https://openrouter.ai/v1/models' }, 403],
    ['incorrect method', { url: modelsUrl, method: 'POST', body: {} }, 405],
    ['missing chat body', { url: chatUrl, method: 'POST' }, 400],
  ])('rejects %s before reaching the upstream', async (_label, payload, status) => {
    const upstream = vi.fn();
    const response = await createLlmProxyHandler(upstream as unknown as typeof fetch)(envelope(payload));
    expect(response.status).toBe(status);
    expect(upstream).not.toHaveBeenCalled();
  });

  it('rejects cross-origin, oversized, malformed and redirected requests', async () => {
    const upstream = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } }));
    const handler = createLlmProxyHandler(upstream as unknown as typeof fetch);
    expect((await handler(envelope({ url: modelsUrl }, 'https://evil.example'))).status).toBe(403);
    expect((await handler(envelope({ url: modelsUrl, padding: 'x'.repeat(1_000_001) }))).status).toBe(413);
    const malformed = new Request('http://localhost:3000/api/llm-proxy', { method: 'POST', body: '{' });
    expect((await handler(malformed)).status).toBe(400);
    const redirect = await handler(envelope({ url: modelsUrl }));
    expect(redirect.status).toBe(502);
    expect(redirect.headers.get('location')).toBeNull();
    expect(upstream).toHaveBeenCalledOnce();
  });

  it('preserves provider errors and hides internal failure details', async () => {
    const denied = await createLlmProxyHandler(async () => new Response('{"error":"unauthorized"}', { status: 401 }))(envelope({ url: modelsUrl }));
    expect(denied.status).toBe(401);
    const unavailable = await createLlmProxyHandler(async () => { throw new Error('Bearer test-secret'); })(envelope({ url: modelsUrl }));
    expect(unavailable.status).toBe(502);
    expect(unavailable.headers.get(PROXY_ERROR)).toBe('1');
    expect(await unavailable.text()).not.toContain('test-secret');
    expect(denied.headers.get(PROXY_ERROR)).toBeNull();
  });

  it('distinguishes a relay failure from a provider key rejection', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"error":{"message":"unreachable"}}', {
      status: 502, headers: { [PROXY_MARK]: '1', [PROXY_ERROR]: '1' },
    }));
    await expect(getJson({ url: modelsUrl, headers: { authorization: 'Bearer test-key' }, apiKey: 'test-key', providerLabel: 'Your server' }))
      .rejects.toMatchObject({ code: 'NETWORK', diagnostic: 'RELAY_ERROR' });
    vi.stubGlobal('fetch', async () => new Response('{"error":"unauthorized"}', { status: 401, headers: { [PROXY_MARK]: '1' } }));
    await expect(getJson({ url: modelsUrl, headers: { authorization: 'Bearer test-key' }, apiKey: 'test-key', providerLabel: 'Your server' }))
      .rejects.toMatchObject({ code: 'AI_KEY_REJECTED' });
  });

  it('leaves unrelated provider requests direct and carries cancellation through the relay', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const controller = new AbortController();
    await llmFetch('https://api.openai.com/v1/models', { signal: controller.signal }, fetchImpl as unknown as typeof fetch);
    expect(fetchImpl).toHaveBeenCalledWith('https://api.openai.com/v1/models', { signal: controller.signal });
    await llmFetch(modelsUrl, { signal: controller.signal, headers: new Headers({ Authorization: 'Bearer test-key' }) }, fetchImpl as unknown as typeof fetch);
    const [, init] = fetchImpl.mock.calls[1] as unknown as [string, RequestInit];
    expect(init.signal).toBe(controller.signal);
    expect(JSON.parse(String(init.body)).headers.authorization).toBe('Bearer test-key');
  });
});
