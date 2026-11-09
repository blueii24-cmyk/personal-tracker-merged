import { createLlmProxyHandler } from '@/tracker/lib/ai/byok/llm-proxy-handler';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

export const POST = createLlmProxyHandler();
