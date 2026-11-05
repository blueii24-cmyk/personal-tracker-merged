import { BRIDGED_HOSTS, BRIDGED_PATHS, PROXY_MARK, PROXY_TARGET_HEADER } from './bridged-hosts';

const MAX_BODY_BYTES = 1_000_000;
const UPSTREAM_TIMEOUT_MS = 60_000;

const reply = (status: number, message: string) =>
  new Response(JSON.stringify({ error: { message } }), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store', [PROXY_MARK]: '1' },
  });

export function createProxyHandler(fetchImpl: typeof fetch = fetch) {
  return async function handle(req: Request): Promise<Response> {
    if (req.method !== 'GET' && req.method !== 'POST') return reply(405, 'Method not allowed.');

    const origin = req.headers.get('origin');
    const host = req.headers.get('host');
    if (origin) {
      try {
        if (!host || new URL(origin).host !== host) return reply(403, 'This relay only serves the app that hosts it.');
      } catch {
        return reply(403, 'This relay only serves the app that hosts it.');
      }
    }

    let target: URL;
    try {
      target = new URL(req.headers.get(PROXY_TARGET_HEADER) ?? '');
    } catch {
      return reply(400, 'Missing or invalid target address.');
    }
    if (target.protocol !== 'https:' || target.username || target.password || target.port) {
      return reply(400, 'Only plain https addresses are allowed.');
    }
    if (!BRIDGED_HOSTS.has(target.hostname)) return reply(400, 'That host is not on the relay allow-list.');
    if (!BRIDGED_PATHS.has(target.pathname)) return reply(400, 'That path is not allowed.');

    const headers: Record<string, string> = { accept: 'application/json' };
    const authorization = req.headers.get('authorization');
    if (authorization) headers.authorization = authorization;
    let body: string | undefined;
    if (req.method === 'POST') {
      body = await req.text();
      if (new TextEncoder().encode(body).byteLength > MAX_BODY_BYTES) return reply(413, 'Request too large.');
      headers['content-type'] = req.headers.get('content-type') ?? 'application/json';
    }

    try {
      const upstream = await fetchImpl(target.toString(), {
        method: req.method,
        headers,
        ...(body === undefined ? {} : { body }),
        redirect: 'manual',
        cache: 'no-store',
        signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS),
      });
      return new Response(await upstream.text(), {
        status: upstream.status,
        headers: {
          'content-type': upstream.headers.get('content-type') ?? 'application/json',
          'cache-control': 'no-store',
          [PROXY_MARK]: '1',
        },
      });
    } catch {
      return reply(502, `Could not reach ${target.hostname} from the app's server.`);
    }
  };
}
