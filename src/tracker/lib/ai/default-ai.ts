/** Authenticated default-AI relay client. No provider key, model, base URL, or system prompt is supplied by the browser. */
import { AI_CHAT_PATH, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/tracker/config';
import { TrackerError } from '@/tracker/lib/api/errors';
import { getSupabase } from '@/tracker/lib/supabase/client';
import type { AiProviderAdapter, AiProviderId, CanonicalToolCall, ProviderGenerateInput, ProviderGenerateOutput } from './provider';

export interface DefaultAiStatus {
  configured: boolean;
  provider: string | null;
  model: string | null;
  maxOutputTokens: number;
  supportsCasualMode: boolean;
}

const asRecord = (value: unknown): Record<string, unknown> | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

function errorFor(status: number, value: unknown): TrackerError {
  const body = asRecord(value);
  const detail = asRecord(body?.error);
  const code = typeof detail?.code === 'string' ? detail.code : '';
  const fallback = status === 401 ? 'Sign in again to use default AI.' : 'Default AI is unavailable. Try again or use your own model.';
  const message = typeof detail?.message === 'string' && detail.message.length <= 500 ? detail.message : fallback;
  if (code === 'unauthenticated' || status === 401) return new TrackerError('UNAUTHENTICATED', message, { retryable: false, status });
  if (code === 'user_quota_exceeded' || code === 'global_quota_exceeded') return new TrackerError('AI_QUOTA_EXCEEDED', message, { retryable: false, status });
  if (code === 'rate_limited' || code === 'provider_rate_limited' || status === 429) return new TrackerError('RATE_LIMITED', message, { retryable: true, status });
  if (['not_configured', 'usage_controls_unavailable', 'pricing_not_configured', 'invalid_server_limits'].includes(code)) return new TrackerError('NOT_CONFIGURED', message, { retryable: false, status });
  if (code === 'provider_model_unavailable') return new TrackerError('AI_MODEL_NOT_FOUND', message, { retryable: false, status });
  if (code === 'invalid_request' || status === 400 || status === 413) return new TrackerError('INVALID_REQUEST', message, { retryable: false, status });
  return new TrackerError('PROVIDER_UNAVAILABLE', message, { retryable: true, status });
}

async function relayRequest(action: 'status' | 'generate', input?: ProviderGenerateInput, signal?: AbortSignal): Promise<unknown> {
  const sb = getSupabase();
  if (!sb) throw new TrackerError('NOT_CONFIGURED', 'Cloud sync is not configured in this build.', { retryable: false });
  const { data, error } = await sb.auth.getSession();
  if (error || !data.session?.access_token) throw new TrackerError('UNAUTHENTICATED', 'Sign in again to use default AI.', { retryable: false });
  let response: Response;
  try {
    response = await fetch(`${SUPABASE_URL}${AI_CHAT_PATH}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${data.session.access_token}`,
        apikey: SUPABASE_PUBLISHABLE_KEY,
        'content-type': 'application/json',
      },
      body: JSON.stringify(action === 'status' ? { action } : {
        action,
        context: input?.relayContext,
        mode: input?.relayContext?.mode,
        messages: input?.messages,
        maxOutputTokens: input?.maxOutputTokens,
      }),
      signal: input?.signal ?? signal,
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch (cause) {
    if (cause instanceof DOMException && cause.name === 'AbortError') throw cause;
    throw new TrackerError('NETWORK', 'Could not reach default AI. Check your connection and try again.', { retryable: true });
  }
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    if (response.ok) throw new TrackerError('AI_ENDPOINT_ERROR', 'Default AI returned an unreadable response.', { retryable: true, status: response.status });
  }
  if (!response.ok) throw errorFor(response.status, body);
  return body;
}

function outputFrom(value: unknown): ProviderGenerateOutput {
  const body = asRecord(value);
  if (!body || typeof body.text !== 'string' || !Array.isArray(body.toolCalls)) throw new TrackerError('AI_ENDPOINT_ERROR', 'Default AI returned an incompatible response.', { retryable: true });
  const toolCalls: CanonicalToolCall[] = body.toolCalls.map((raw) => {
    const call = asRecord(raw);
    if (!call || typeof call.id !== 'string' || typeof call.name !== 'string' || !asRecord(call.arguments)) throw new TrackerError('AI_ENDPOINT_ERROR', 'Default AI returned an invalid tool call.', { retryable: true });
    return { id: call.id, name: call.name, arguments: call.arguments as Record<string, unknown> };
  });
  const usage = asRecord(body.usage);
  const numberOrUndefined = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
  return {
    text: body.text,
    toolCalls,
    finishReason: ['stop', 'tool_calls', 'length', 'provider_error'].includes(String(body.finishReason)) ? body.finishReason as ProviderGenerateOutput['finishReason'] : 'stop',
    usage: { inputTokens: numberOrUndefined(usage?.inputTokens), outputTokens: numberOrUndefined(usage?.outputTokens) },
    providerRequestId: typeof body.providerRequestId === 'string' ? body.providerRequestId : undefined,
    model: typeof body.model === 'string' ? body.model : undefined,
  };
}

export class DefaultAiAdapter implements AiProviderAdapter {
  readonly providerId: AiProviderId = 'openai-compatible';
  async generate(input: ProviderGenerateInput): Promise<ProviderGenerateOutput> {
    if (!input.relayContext) throw new TrackerError('INVALID_REQUEST', 'Default AI needs tracker context.', { retryable: false });
    if (input.relayContext.mode === 'casual') {
      const status = await getDefaultAiStatus(input.signal);
      if (!status.supportsCasualMode) throw new TrackerError('NOT_CONFIGURED', 'The default AI server needs an update before Casual Mode is available.', { retryable: false });
    }
    return outputFrom(await relayRequest('generate', input));
  }
}

/** Configuration only: this does not claim provider connectivity or available quota. */
export async function getDefaultAiStatus(signal?: AbortSignal): Promise<DefaultAiStatus> {
  const body = asRecord(await relayRequest('status', undefined, signal));
  return {
    configured: body?.configured === true,
    provider: typeof body?.provider === 'string' ? body.provider : null,
    model: typeof body?.model === 'string' ? body.model : null,
    maxOutputTokens: typeof body?.maxOutputTokens === 'number' ? body.maxOutputTokens : 0,
    supportsCasualMode: body?.supportsCasualMode === true,
  };
}
