import { createLlmProxyHandler } from '@/tracker/lib/ai/byok/llm-proxy-handler';
import { PROXY_MARK } from '@/tracker/lib/ai/byok/bridged-hosts';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

// No credentials or upstream calls: lets a static copy choose direct Gemini
// before a chat POST, without retrying a request that may have been processed.
export const GET = () => new Response(null, { status: 204, headers: { [PROXY_MARK]: '1', 'cache-control': 'no-store' } });
export const POST = createLlmProxyHandler();
