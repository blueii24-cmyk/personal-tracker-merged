import { afterEach, describe, expect, it, vi } from 'vitest';
import { postJson } from './http';

describe('postJson connectivity', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('fails fast with a clear message when the device is offline, without calling the network', async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('navigator', { onLine: false });
    await expect(postJson({ url: 'https://api.example.com/v1', headers: {}, body: {}, apiKey: 'sk-secret-secret-1234', providerLabel: 'Example', notFoundMeansModel: true, model: 'm' })).rejects.toMatchObject({ code: 'NETWORK', retryable: true });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
  it('still works when AbortSignal.timeout / any are missing (older Android WebViews)', async () => {
    const original = { timeout: AbortSignal.timeout, any: AbortSignal.any };
    // @ts-expect-error simulating an old engine
    AbortSignal.timeout = undefined;
    // @ts-expect-error simulating an old engine
    AbortSignal.any = undefined;
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ ok: true }), { status: 200 })));
    try {
      const ctl = new AbortController();
      const r = await postJson<{ ok: boolean }>({ url: 'https://api.example.com/v1', headers: {}, body: {}, apiKey: 'k', providerLabel: 'Example', notFoundMeansModel: true, model: 'm', signal: ctl.signal });
      expect(r.data.ok).toBe(true);
    } finally {
      AbortSignal.timeout = original.timeout;
      AbortSignal.any = original.any;
    }
  });
});
