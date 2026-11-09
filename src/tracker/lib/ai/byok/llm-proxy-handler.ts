import { PROXY_ERROR, PROXY_MARK } from './bridged-hosts';

const MAX_REQUEST_BYTES = 1_000_000;
const UPSTREAM_TIMEOUT_MS = 55_000;
const ALLOWED_PATHS: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  'integrate.api.nvidia.com': { '/v1/models': 'GET', '/v1/chat/completions': 'POST' },
  'openrouter.ai': { '/api/v1/models': 'GET', '/api/v1/chat/completions': 'POST' },
};

const responseHeaders = (contentType = 'application/json') => ({
  'content-type': contentType,
  'cache-control': 'no-store',
  [PROXY_MARK]: '1',
});
const reject = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { message } }), { status, headers: { ...responseHeaders(), [PROXY_ERROR]: '1' } });

/** Read at most the configured number of bytes even when Content-Length is missing or false. */
async function readLimited(req: Request): Promise<string | null> {
  const length = req.headers.get('content-length');
  if (length && Number(length) > MAX_REQUEST_BYTES) return null;
  if (!req.body) return '';
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_REQUEST_BYTES) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** BYOK relay: a narrow provider allow-list; never logs or persists the submitted key. */
export function createLlmProxyHandler(fetchImpl: typeof fetch = fetch) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method !== 'POST') return reject(405, 'Only POST is allowed.');
    const origin = req.headers.get('origin');
    if (origin) {
      try {
        if (!req.headers.get('host') || new URL(origin).host !== req.headers.get('host')) {
          return reject(403, 'This relay only serves the app that hosts it.');
        }
      } catch {
        return reject(403, 'This relay only serves the app that hosts it.');
      }
    }

    let data: unknown;
    try {
      const text = await readLimited(req);
      if (text === null) return reject(413, 'Request too large.');
      data = JSON.parse(text);
    } catch {
      return reject(400, 'Invalid JSON request.');
    }
    if (!data || typeof data !== 'object' || Array.isArray(data)) return reject(400, 'Invalid JSON request.');
    const input = data as Record<string, unknown>;
    if (typeof input.url !== 'string') return reject(400, 'Missing or invalid target address.');
    let target: URL;
    try {
      target = new URL(input.url);
    } catch {
      return reject(400, 'Missing or invalid target address.');
    }
    if (target.protocol !== 'https:' || target.username || target.password || target.port || target.hash) {
      return reject(400, 'Only plain https addresses are allowed.');
    }
    const expectedMethod = Object.hasOwn(ALLOWED_PATHS, target.hostname) ? ALLOWED_PATHS[target.hostname]?.[target.pathname] : undefined;
    if (!expectedMethod) return reject(403, 'That provider or endpoint is not allowed.');
    const method = input.method ?? 'GET';
    if (method !== expectedMethod) return reject(405, 'Method not allowed for this endpoint.');
    if (input.headers !== undefined && (!input.headers || typeof input.headers !== 'object' || Array.isArray(input.headers))) {
      return reject(400, 'Invalid request headers.');
    }
    let authorization: string | null;
    try {
      const supplied = new Headers(input.headers as Record<string, string> | undefined);
      authorization = supplied.get('authorization');
    } catch {
      return reject(400, 'Invalid request headers.');
    }
    const headers: Record<string, string> = { accept: 'application/json, text/event-stream' };
    if (authorization) headers.authorization = authorization;
    let body: string | undefined;
    if (method === 'POST') {
      if (input.body === undefined || !input.body || typeof input.body !== 'object' || Array.isArray(input.body)) {
        return reject(400, 'A JSON object is required for chat.');
      }
      body = JSON.stringify(input.body);
      headers['content-type'] = 'application/json';
    }
    try {
      const upstream = await fetchImpl(target.toString(), {
        method,
        headers,
        ...(body === undefined ? {} : { body }),
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      if (upstream.status >= 300 && upstream.status < 400) {
        return reject(502, 'The provider returned an unsupported redirect.');
      }
      const noBody = upstream.status === 204 || upstream.status === 205 || upstream.status === 304;
      return new Response(noBody ? null : upstream.body, {
        status: upstream.status,
        headers: responseHeaders(upstream.headers.get('content-type') ?? 'application/json'),
      });
    } catch {
      return reject(502, `Could not reach ${target.hostname} from the app's server.`);
    }
  };
}
