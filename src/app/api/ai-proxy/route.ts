import { createProxyHandler } from '@/tracker/lib/ai/byok/proxy-handler';

export const dynamic = 'force-dynamic';

const handle = createProxyHandler();
export const GET = handle;
export const POST = handle;
