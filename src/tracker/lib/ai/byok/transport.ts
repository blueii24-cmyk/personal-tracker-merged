import { CapacitorHttp } from '@capacitor/core';
import { isNative } from '@/tracker/lib/platform/native';
import { isBridgedHost, PROXY_ERROR, PROXY_MARK } from './bridged-hosts';
import { llmFetch } from './llm-fetch';

export interface AiFetchInit {
  method: 'GET' | 'POST';
  headers: Record<string, string>;
  body?: string;
  signal: AbortSignal;
}

interface NativeResponse {
  status: number;
  data: unknown;
  headers: Record<string, string>;
}

interface TransportDeps {
  native: boolean;
  fetchImpl: typeof fetch;
  nativeRequest: (options: {
    url: string;
    method: string;
    headers: Record<string, string>;
    data?: unknown;
    readTimeout?: number;
    connectTimeout?: number;
  }) => Promise<NativeResponse>;
}

const abortError = () => new DOMException('The operation was aborted.', 'AbortError');

export async function aiFetch(
  url: string,
  init: AiFetchInit,
  deps?: Partial<TransportDeps>,
): Promise<{ res: Response; viaRelay: boolean }> {
  const resolved: TransportDeps = {
    native: deps?.native ?? isNative(),
    fetchImpl: deps?.fetchImpl ?? fetch,
    nativeRequest:
      deps?.nativeRequest ??
      ((options) => CapacitorHttp.request(options) as Promise<NativeResponse>),
  };

  if (!isBridgedHost(url)) {
    return {
      res: await resolved.fetchImpl(url, {
        method: init.method,
        headers: init.headers,
        ...(init.body === undefined ? {} : { body: init.body }),
        signal: init.signal,
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
      }),
      viaRelay: false,
    };
  }

  if (resolved.native) {
    if (init.signal.aborted) throw abortError();
    let data: unknown = init.body;
    if (init.body !== undefined) {
      try {
        data = JSON.parse(init.body);
      } catch {
        data = init.body;
      }
    }
    const cancelled = new Promise<never>((_, reject) =>
      init.signal.addEventListener('abort', () => reject(abortError()), { once: true }),
    );
    const response = await Promise.race([
      resolved.nativeRequest({
        url,
        method: init.method,
        headers: init.headers,
        data,
        readTimeout: 60_000,
        connectTimeout: 20_000,
      }),
      cancelled,
    ]);
    const hasBody = response.status !== 204 && response.status !== 205 && response.status !== 304;
    const text = typeof response.data === 'string' ? response.data : JSON.stringify(response.data ?? null);
    return {
      res: new Response(hasBody ? text : null, {
        status: response.status,
        headers: { 'content-type': 'application/json' },
      }),
      viaRelay: false,
    };
  }

  const target = new URL(url);
  // Only model discovery is safe to retry automatically. Never replay a chat POST:
  // the first request may already have been processed even if its response was lost.
  const canTryDirect = init.method === 'GET' && target.hostname === 'openrouter.ai' &&
    target.pathname === '/api/v1/models' && !target.port && !target.username && !target.password && !target.hash;
  const directModels = async () => ({
    res: await resolved.fetchImpl(url, {
      method: 'GET', headers: init.headers, signal: init.signal,
      credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error',
    }),
    viaRelay: false,
  });
  let response: Response;
  try {
    response = await llmFetch(url, {
      method: init.method,
      headers: init.headers,
      ...(init.body === undefined ? {} : { body: init.body }),
      signal: init.signal,
    }, resolved.fetchImpl);
  } catch (error) {
    if (canTryDirect && !init.signal.aborted) return directModels();
    throw error;
  }
  // A missing deployment route or a relay-side upstream failure is not a provider
  // authentication response. Direct discovery can still work if OpenRouter permits CORS.
  if (canTryDirect && !init.signal.aborted &&
      (!response.headers.has(PROXY_MARK) || (response.status >= 500 && response.headers.get(PROXY_ERROR) === '1'))) {
    return directModels();
  }
  return { res: response, viaRelay: true };
}

export const relayIsMissing = (response: Response): boolean => !response.headers.has(PROXY_MARK);
