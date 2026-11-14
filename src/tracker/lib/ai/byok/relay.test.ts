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
  it('relays OpenRouter model discovery through the JSON endpoint', async () => {
    const url = 'https://openrouter.ai/api/v1/models';
    const fetchImpl = vi.fn(async () => new Response('{}', { headers: { [PROXY_MARK]: '1' } }));
    const result = await aiFetch(url, {
      method: 'GET',
      headers: { authorization: 'Bearer test-key' },
      signal: signal(),
    }, { native: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.viaRelay).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(LLM_PROXY_PATH, expect.objectContaining({
      method: 'POST', credentials: 'same-origin', cache: 'no-store',
      body: JSON.stringify({ url, method: 'GET', headers: { authorization: 'Bearer test-key' } }),
    }));
  });

  it('routes OpenRouter chat POST through the JSON relay without a direct retry', async () => {
    const url = 'https://openrouter.ai/api/v1/chat/completions';
    const controller = new AbortController();
    const fetchImpl = vi.fn(async () => new Response('{}', { headers: { [PROXY_MARK]: '1' } }));
    const result = await aiFetch(url, {
      method: 'POST', headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' },
      body: JSON.stringify({ model: 'test', messages: [] }), signal: controller.signal,
    }, { native: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.viaRelay).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl).toHaveBeenCalledWith(LLM_PROXY_PATH, expect.objectContaining({
      method: 'POST', signal: controller.signal, credentials: 'same-origin',
      body: JSON.stringify({ url, method: 'POST', headers: { authorization: 'Bearer test-key', 'content-type': 'application/json' }, body: { model: 'test', messages: [] } }),
    }));
  });

  it.each(['network', 'missing relay', 'relay upstream failure'])('falls back to direct OpenRouter discovery on %s', async (reason) => {
    const url = 'https://openrouter.ai/api/v1/models';
    const fetchImpl = vi.fn(async (request: string) => {
      if (request === LLM_PROXY_PATH) {
        if (reason === 'network') throw new TypeError('Failed to fetch');
        if (reason === 'missing relay') return new Response('missing', { status: 404 });
        return new Response('{}', { status: 502, headers: { [PROXY_MARK]: '1', [PROXY_ERROR]: '1' } });
      }
      return new Response('{"data":[]}');
    });
    const result = await aiFetch(url, { method: 'GET', headers: { authorization: 'Bearer test-key' }, signal: signal() }, { native: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.viaRelay).toBe(false);
    expect(await result.res.json()).toEqual({ data: [] });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenLastCalledWith(url, expect.objectContaining({ method: 'GET', credentials: 'omit', referrerPolicy: 'no-referrer', headers: { authorization: 'Bearer test-key' } }));
  });

  it('never retries chat writes when a relay request fails', async () => {
    const fetchImpl = vi.fn(async () => { throw new TypeError('Failed to fetch'); });
    await expect(aiFetch('https://openrouter.ai/api/v1/chat/completions', { method: 'POST', headers: { authorization: 'Bearer test-key' }, body: '{}', signal: signal() }, { native: false, fetchImpl: fetchImpl as unknown as typeof fetch })).rejects.toThrow('Failed to fetch');
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('does not bypass a provider authentication error or retry an aborted discovery', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"unauthorized"}', { status: 401, headers: { [PROXY_MARK]: '1' } }));
    const url = 'https://openrouter.ai/api/v1/models';
    const result = await aiFetch(url, { method: 'GET', headers: {}, signal: signal() }, { native: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.res.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledOnce();
    const ctl = new AbortController();
    ctl.abort();
    const failing = vi.fn(async () => { throw new DOMException('Aborted', 'AbortError'); });
    await expect(aiFetch(url, { method: 'GET', headers: {}, signal: ctl.signal }, { native: false, fetchImpl: failing as unknown as typeof fetch })).rejects.toMatchObject({ name: 'AbortError' });
    expect(failing).toHaveBeenCalledOnce();
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

  it('enforces the JSON relay limits and redirect policy for OpenRouter chat', async () => {
    const url = 'https://openrouter.ai/api/v1/chat/completions';
    const upstream = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example' } }));
    const handler = createLlmProxyHandler(upstream as unknown as typeof fetch);
    const relayFetch = vi.fn(async (_url: string, init: RequestInit) => handler(new Request('http://localhost:3000/api/llm-proxy', {
      ...init, headers: { ...Object.fromEntries(new Headers(init.headers).entries()), host: 'localhost:3000', origin: 'http://localhost:3000' },
    })));
    const send = (body: object) => aiFetch(url, { method: 'POST', headers: { authorization: 'Bearer test-key' }, body: JSON.stringify(body), signal: signal() }, { native: false, fetchImpl: relayFetch as unknown as typeof fetch });
    const oversized = await send({ model: 'test', padding: 'x'.repeat(1_000_001) });
    expect(oversized.res.status).toBe(413);
    expect(upstream).not.toHaveBeenCalled();
    const redirect = await send({ model: 'test' });
    expect(redirect.res.status).toBe(502);
    expect(redirect.res.headers.get('location')).toBeNull();
    expect(upstream).toHaveBeenCalledOnce();
    const [forwarded, options] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(forwarded).toBe(url);
    expect(options).toMatchObject({ method: 'POST', redirect: 'manual', body: '{"model":"test"}', headers: { authorization: 'Bearer test-key' } });
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

describe('Gemini JSON relay', () => {
  const base = 'https://generativelanguage.googleapis.com';
  const modelUrl = `${base}/v1beta/models?pageSize=1000`;
  const chatUrl = `${base}/v1beta/models/gemini-2.5-flash:generateContent`;
  it('sends only the Google key to Google for discovery and chat', async () => {
    const upstream = vi.fn(async () => new Response('{"models":[]}'));
    const handler = createLlmProxyHandler(upstream as unknown as typeof fetch);
    const headers = { 'x-goog-api-key': 'AIza-fake-key-for-tests', authorization: 'Bearer do-not-forward', cookie: 'no' };
    expect((await handler(envelope({ url: modelUrl, method: 'GET', headers }))).status).toBe(200);
    expect((await handler(envelope({ url: chatUrl, method: 'POST', headers, body: { contents: [] } }))).status).toBe(200);
    const [url, first] = upstream.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe(modelUrl);
    expect(url).not.toContain('fake-key');
    expect(first.headers).toEqual({ accept: 'application/json, text/event-stream', 'x-goog-api-key': 'AIza-fake-key-for-tests' });
    const [, second] = upstream.mock.calls[1] as unknown as [string, RequestInit];
    expect(second.headers).toEqual({ accept: 'application/json, text/event-stream', 'x-goog-api-key': 'AIza-fake-key-for-tests', 'content-type': 'application/json' });
    expect(second.redirect).toBe('manual');
  });
  it.each([
    [`${base}/v1beta/models?key=secret`, 'GET'],
    [`${base}/v1beta/models?pageSize=1000&pageSize=1000`, 'GET'],
    [`${base}/v1beta/models/gemini:generateContent?key=secret`, 'POST'],
    [`${base}/v1beta/models/gemini%2Felse:generateContent`, 'POST'],
    [`${base}/v1beta/models/gemini:streamGenerateContent`, 'POST'],
    [`${base}.evil.example/v1beta/models`, 'GET'],
  ])('rejects disallowed target %s', async (url, method) => {
    const upstream = vi.fn();
    const res = await createLlmProxyHandler(upstream as unknown as typeof fetch)(envelope({ url, method, headers: { 'x-goog-api-key': 'fake-key' }, ...(method === 'POST' ? { body: {} } : {}) }));
    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('does not forward a Google key to another provider or through the legacy route', async () => {
    const upstream = vi.fn(async () => new Response('{}'));
    const handler = createLlmProxyHandler(upstream as unknown as typeof fetch);
    await handler(envelope({ url: 'https://openrouter.ai/api/v1/models', method: 'GET', headers: { 'x-goog-api-key': 'fake-key' } }));
    expect((upstream.mock.calls[0] as unknown as [string, RequestInit])[1].headers).toEqual({ accept: 'application/json, text/event-stream' });
    const legacy = await createProxyHandler(upstream as unknown as typeof fetch)(request({ target: `${base}/v1/models` }));
    expect(legacy.status).toBe(400);
  });
  it('uses the relay for browser Gemini and the native client on Android', async () => {
    const fetchImpl = vi.fn(async () => new Response('{}', { headers: { [PROXY_MARK]: '1' } }));
    const init = { method: 'POST' as const, headers: { 'x-goog-api-key': 'fake-key' }, body: '{"contents":[]}', signal: signal() };
    const web = await aiFetch(chatUrl, init, { native: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(web.viaRelay).toBe(true);
    const call = fetchImpl.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(JSON.parse(String(call[1].body))).toMatchObject({ url: chatUrl, method: 'POST', headers: { 'x-goog-api-key': 'fake-key' } });
    const nativeRequest = vi.fn(async () => ({ status: 200, data: {}, headers: {} }));
    await aiFetch(chatUrl, init, { native: true, nativeRequest });
    expect(nativeRequest).toHaveBeenCalledWith(expect.objectContaining({ url: chatUrl, method: 'POST', headers: { 'x-goog-api-key': 'fake-key' } }));
  });
  it('never retries a Gemini chat POST after a missing relay', async () => {
    const fetchImpl = vi.fn(async () => new Response('missing', { status: 404 }));
    await aiFetch(chatUrl, { method: 'POST', headers: { 'x-goog-api-key': 'fake-key' }, body: '{}', signal: signal() }, { native: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });
  it('allows static web copies to use direct Gemini after discovery confirms it works', async () => {
    const fetchImpl = vi.fn(async (url: string) => url === LLM_PROXY_PATH ? new Response('missing', { status: 404 }) : new Response('{"models":[]}'));
    const discovery = await aiFetch(modelUrl, { method: 'GET', headers: { 'x-goog-api-key': 'fake-key' }, signal: signal() }, { native: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(discovery.viaRelay).toBe(false);
    const chat = await aiFetch(chatUrl, { method: 'POST', headers: { 'x-goog-api-key': 'fake-key' }, body: '{}', signal: signal() }, { native: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(chat.viaRelay).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });
});

describe('standalone Gemini without prior discovery', () => {
  it('probes without credentials, then sends the chat only once directly when the route is absent', async () => {
    vi.resetModules();
    const { aiFetch: freshFetch } = await import('./transport');
    const fetchImpl = vi.fn(async (url: string) => url === LLM_PROXY_PATH ? new Response('missing', { status: 404 }) : new Response('{"candidates":[]}'));
    const url = 'https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent';
    const response = await freshFetch(url, { method: 'POST', headers: { 'x-goog-api-key': 'fake-key' }, body: '{}', signal: signal() }, { native: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(response.viaRelay).toBe(false);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    const probe = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(probe[0]).toBe(LLM_PROXY_PATH);
    expect(probe[1].method).toBe('GET');
    expect(probe[1].headers).toBeUndefined();
    expect(probe[1].body).toBeUndefined();
    expect((fetchImpl.mock.calls[1] as unknown as [string, RequestInit])[0]).toBe(url);
  });
});

describe('Gemini direct discovery failures', () => {
  it('does not cache a failed direct discovery as a working transport', async () => {
    vi.resetModules();
    const { aiFetch: freshFetch } = await import('./transport');
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      if (url !== LLM_PROXY_PATH) return new Response('bad key', { status: 403 });
      if (init.method === 'GET') return new Response(null, { status: 204, headers: { [PROXY_MARK]: '1' } });
      return new Response('relay failed', { status: 502, headers: { [PROXY_MARK]: '1', [PROXY_ERROR]: '1' } });
    });
    const init = { headers: { 'x-goog-api-key': 'fake-key' }, signal: signal() };
    await freshFetch('https://generativelanguage.googleapis.com/v1beta/models?pageSize=1000', { ...init, method: 'GET' }, { native: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    const result = await freshFetch('https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent', { ...init, method: 'POST', body: '{}' }, { native: false, fetchImpl: fetchImpl as unknown as typeof fetch });
    expect(result.viaRelay).toBe(true);
    const last = fetchImpl.mock.calls.at(-1) as unknown as [string, RequestInit];
    expect(last[0]).toBe(LLM_PROXY_PATH);
  });
});

describe('Coarena integration and relay', () => {
  const models = 'https://coarena.ai/api/v1/models';
  const chat = 'https://coarena.ai/api/v1/chat/completions';
  it('forwards discovery and chat through the restricted JSON relay with bearer auth', async () => {
    const upstream = vi.fn(async () => new Response('{"data":[{"id":"sample-model"}]}'));
    const handler = createLlmProxyHandler(upstream as unknown as typeof fetch);
    const headers = { authorization: 'Bearer coa_fake-key-for-tests', cookie: 'do-not-forward', 'x-goog-api-key': 'do-not-forward' };
    expect((await handler(envelope({ url: models, method: 'GET', headers }))).status).toBe(200);
    expect((await handler(envelope({ url: chat, method: 'POST', headers, body: { model: 'sample-model', messages: [] } }))).status).toBe(200);
    const first = upstream.mock.calls[0] as unknown as [string, RequestInit];
    const second = upstream.mock.calls[1] as unknown as [string, RequestInit];
    expect(first[0]).toBe(models);
    expect(first[1].headers).toEqual({ accept: 'application/json, text/event-stream', authorization: 'Bearer coa_fake-key-for-tests' });
    expect(second[0]).toBe(chat);
    expect(second[1]).toMatchObject({ method: 'POST', redirect: 'manual', body: '{"model":"sample-model","messages":[]}' });
    expect(second[1].headers).toEqual({ accept: 'application/json, text/event-stream', authorization: 'Bearer coa_fake-key-for-tests', 'content-type': 'application/json' });
  });
  it.each([
    { url: 'https://coarena.ai.evil.example/api/v1/models' },
    { url: 'https://coarena.ai/api/v1/keys' },
    { url: 'https://coarena.ai/api/v1/requests' },
    { url: 'https://coarena.ai/api/v1/models?key=secret' },
    { url: models, method: 'POST', body: {} },
    { url: chat, method: 'GET' },
    { url: 'https://u:p@coarena.ai/api/v1/models' },
    { url: 'https://coarena.ai:8443/api/v1/models' },
  ])('rejects unapproved Coarena request %o', async (payload) => {
    const upstream = vi.fn();
    const result = await createLlmProxyHandler(upstream as unknown as typeof fetch)(envelope(payload));
    expect(result.status).toBeGreaterThanOrEqual(400);
    expect(upstream).not.toHaveBeenCalled();
  });
  it('blocks redirects and excludes the older generic relay', async () => {
    const upstream = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'https://evil.example/' } }));
    const response = await createLlmProxyHandler(upstream as unknown as typeof fetch)(envelope({ url: models }));
    expect(response.status).toBe(502);
    expect(response.headers.get('location')).toBeNull();
    expect((await createProxyHandler(upstream as unknown as typeof fetch)(request({ target: models }))).status).toBe(400);
    expect(upstream).toHaveBeenCalledOnce();
  });
  it('routes web calls through the relay without replaying chat and Android through native HTTP', async () => {
    const fetchImpl = vi.fn(async () => new Response('{"error":"missing"}', { status: 404 }));
    const payload = { method: 'POST' as const, headers: { authorization: 'Bearer coa_fake-key-for-tests' }, body: '{}', signal: signal() };
    expect((await aiFetch(chat, payload, { native: false, fetchImpl: fetchImpl as unknown as typeof fetch })).viaRelay).toBe(true);
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect((fetchImpl.mock.calls[0] as unknown as [string])[0]).toBe(LLM_PROXY_PATH);
    const nativeRequest = vi.fn(async () => ({ status: 200, data: {}, headers: {} }));
    await aiFetch(models, { method: 'GET', headers: payload.headers, signal: signal() }, { native: true, nativeRequest });
    await aiFetch(chat, payload, { native: true, nativeRequest });
    expect(nativeRequest).toHaveBeenCalledTimes(2);
    expect(nativeRequest).toHaveBeenLastCalledWith(expect.objectContaining({ url: chat, method: 'POST', headers: payload.headers }));
  });
  it('does not mistake a late Coarena error delivered with HTTP 200 for a success', async () => {
    vi.stubGlobal('fetch', async () => new Response('{"error":{"message":"secret coa_fake-key-for-tests"}}', { status: 200, headers: { [PROXY_MARK]: '1' } }));
    await expect(getJson({ url: models, headers: { authorization: 'Bearer coa_fake-key-for-tests' }, apiKey: 'coa_fake-key-for-tests', providerLabel: 'Your server' })).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', diagnostic: 'PROVIDER_ERROR' });
  });
});
