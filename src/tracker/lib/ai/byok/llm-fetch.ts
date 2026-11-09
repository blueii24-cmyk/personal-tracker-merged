import { isBridgedHost } from './bridged-hosts';

export const LLM_PROXY_PATH = '/api/llm-proxy';

/** Route NVIDIA through the same-origin Next.js function; other providers retain their existing transport. */
export async function llmFetch(url: string, init: RequestInit = {}, fetchImpl: typeof fetch = fetch): Promise<Response> {
  if (!isBridgedHost(url) || new URL(url).hostname !== 'integrate.api.nvidia.com') return fetchImpl(url, init);
  const headers = Object.fromEntries(new Headers(init.headers).entries());
  let body: unknown;
  if (init.body != null) {
    if (typeof init.body !== 'string') throw new TypeError('The LLM relay requires a JSON request body.');
    body = JSON.parse(init.body);
  }
  return fetchImpl(LLM_PROXY_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    signal: init.signal,
    credentials: 'same-origin',
    cache: 'no-store',
    referrerPolicy: 'no-referrer',
    body: JSON.stringify({ url, method: init.method ?? 'GET', headers, ...(body === undefined ? {} : { body }) }),
  });
}
