// Supabase Edge Function: authenticated default-AI generation relay (Deno).
// Provider credentials are server-only. This function NEVER executes tracker tools or writes tracker records.
// @ts-nocheck - Deno runtime, type-checked by the Supabase CLI rather than by the app's tsconfig.
import { createClient } from 'npm:@supabase/supabase-js@2';
import {
  AiRequestError, DEFAULT_AI_MAX_BODY_BYTES, DEFAULT_AI_MAX_OUTPUT_TOKENS, ProviderCompatibilityError,
  buildRelaySystem, estimateInputTokens, parseProviderOutput, toProviderBody, usageCostMicros, validateGenerateInput,
} from '../_shared/ai-core.ts';

const env = (key: string) => (Deno.env.get(key) ?? '').trim();
const ORIGINS = env('APP_ALLOWED_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean);
const PROVIDER = env('AI_PROVIDER') || 'openai-compatible';
const API_KEY = env('AI_API_KEY');
const MODEL = env('AI_MODEL');
const BASE_URL = (env('AI_BASE_URL') || 'https://openrouter.ai/api/v1').replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
const admin = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

function baseUrlValid(): boolean {
  try {
    const url = new URL(BASE_URL);
    return url.protocol === 'https:' && !url.username && !url.password && !url.search && !url.hash;
  } catch {
    return false;
  }
}
const configured = Boolean(PROVIDER === 'openai-compatible' && API_KEY && MODEL && MODEL.length <= 120 && !/\s/.test(MODEL) && baseUrlValid());

function numberEnv(key: string, fallback: number, min: number, max: number): number {
  const raw = env(key);
  if (!raw) return fallback;
  const value = Number(raw);
  return Number.isFinite(value) && value >= min && value <= max ? value : Number.NaN;
}

const corsFor = (req: Request) => {
  const origin = req.headers.get('origin') ?? '';
  const ok = origin === 'https://localhost' || ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': ok ? origin : 'null',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
};
const json = (req: Request, status: number, body: unknown) => new Response(JSON.stringify(body), {
  status, headers: { ...corsFor(req), 'content-type': 'application/json', 'cache-control': 'no-store' },
});
const fail = (req: Request, status: number, code: string, message: string) => json(req, status, { error: { code, message } });

async function authenticate(req: Request): Promise<string | null> {
  const jwt = (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '');
  if (!jwt) return null;
  const { data, error } = await admin.auth.getUser(jwt);
  return error || !data.user ? null : data.user.id;
}

function quotaFailure(req: Request, error: unknown): Response {
  const message = String((error as { message?: string })?.message ?? error);
  if (message.includes('rate_limited')) return fail(req, 429, 'rate_limited', 'Too many AI requests. Wait a minute and try again.');
  if (message.includes('user_quota_exceeded')) return fail(req, 429, 'user_quota_exceeded', 'Your daily AI allowance is exhausted. Try again tomorrow or use your own provider key.');
  if (message.includes('global_quota_exceeded')) return fail(req, 429, 'global_quota_exceeded', 'The shared AI allowance is exhausted. Try again later or use your own provider key.');
  // Missing/broken usage controls must fail closed: never call the provider without quotas.
  return fail(req, 503, 'usage_controls_unavailable', 'AI usage controls are not ready. No provider request was made.');
}

function providerFailure(req: Request, status: number): Response {
  if (status === 429) return fail(req, 429, 'provider_rate_limited', 'The AI provider is busy. Try again shortly.');
  if (status === 401 || status === 403) return fail(req, 502, 'provider_auth_failed', 'The default AI provider rejected its server configuration. Use your own key or contact the app owner.');
  if (status === 404) return fail(req, 502, 'provider_model_unavailable', 'The configured default AI model is unavailable. Use your own model or contact the app owner.');
  if (status === 400 || status === 404 || status === 422) return fail(req, 502, 'provider_incompatible', 'The configured provider does not support this chat-and-tools request. Choose a compatible server model.');
  return fail(req, 502, 'provider_unavailable', 'The default AI provider is unavailable. Try again or use your own model.');
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsFor(req) });
  if (req.method !== 'POST') return fail(req, 405, 'method_not_allowed', 'Use POST.');
  const userId = await authenticate(req);
  if (!userId) return fail(req, 401, 'unauthenticated', 'Sign in again.');

  const declared = Number(req.headers.get('content-length') ?? 0);
  if (declared > DEFAULT_AI_MAX_BODY_BYTES) return fail(req, 413, 'request_too_large', 'The AI request is too large. Start a new chat or shorten the message.');
  let rawBody: string;
  try {
    rawBody = await req.text();
  } catch {
    return fail(req, 400, 'bad_request', 'Invalid request.');
  }
  if (new TextEncoder().encode(rawBody).length > DEFAULT_AI_MAX_BODY_BYTES) return fail(req, 413, 'request_too_large', 'The AI request is too large. Start a new chat or shorten the message.');
  let body: Record<string, unknown>;
  try {
    body = JSON.parse(rawBody);
  } catch {
    return fail(req, 400, 'bad_request', 'Invalid request.');
  }
  const action = body?.action;
  if (action === 'status') {
    return json(req, 200, {
      configured,
      provider: configured ? PROVIDER : null,
      model: configured ? MODEL : null,
      maxOutputTokens: DEFAULT_AI_MAX_OUTPUT_TOKENS,
      // This reports configuration only, not provider connectivity or remaining quota.
    });
  }
  if (action !== 'generate') return fail(req, 400, 'bad_request', 'Unknown action.');
  if (!configured) return fail(req, 503, 'not_configured', 'Default AI is not configured on the server. Add your own provider key or contact the app owner.');

  let input;
  try {
    input = validateGenerateInput(body);
  } catch (error) {
    if (error instanceof AiRequestError) return fail(req, 400, 'invalid_request', error.message);
    return fail(req, 400, 'invalid_request', 'Invalid AI request.');
  }

  const limits = {
    rate: numberEnv('AI_RATE_PER_MINUTE', 6, 1, 1000),
    userRequests: numberEnv('AI_USER_DAILY_REQUESTS', 80, 1, 1_000_000),
    userTokens: numberEnv('AI_USER_DAILY_TOKENS', 120_000, 1000, 1_000_000_000),
    globalRequests: numberEnv('AI_GLOBAL_DAILY_REQUESTS', 2000, 1, 100_000_000),
    globalTokens: numberEnv('AI_GLOBAL_DAILY_TOKENS', 5_000_000, 1000, 1_000_000_000_000),
    timeoutMs: numberEnv('AI_PROVIDER_TIMEOUT_MS', 45_000, 1000, 60_000),
  };
  if (Object.values(limits).some((value) => !Number.isFinite(value))) return fail(req, 503, 'invalid_server_limits', 'Default AI limits are invalid. No provider request was made.');
  const inputPrice = numberEnv('AI_INPUT_USD_PER_MILLION', 0, 0, 1_000_000);
  const outputPrice = numberEnv('AI_OUTPUT_USD_PER_MILLION', 0, 0, 1_000_000);
  const spendCapUsd = numberEnv('AI_GLOBAL_DAILY_SPEND_USD', 0, 0, 1_000_000);
  if (![inputPrice, outputPrice, spendCapUsd].every(Number.isFinite)) return fail(req, 503, 'invalid_server_limits', 'Default AI spending limits are invalid. No provider request was made.');
  if (spendCapUsd > 0 && (inputPrice <= 0 || outputPrice <= 0)) {
    // A dollar cap without complete pricing cannot be enforced honestly.
    return fail(req, 503, 'pricing_not_configured', 'Default AI spending controls are incomplete. No provider request was made.');
  }
  const spendCapMicros = Math.round(spendCapUsd * 1_000_000);
  const system = buildRelaySystem(input, new Date());
  const reservedInput = estimateInputTokens(system, input);
  const reservedOutput = input.maxOutputTokens;
  const reservedCost = usageCostMicros(reservedInput, reservedOutput, inputPrice, outputPrice);
  const day = new Date().toISOString().slice(0, 10);
  const { data: reservationId, error: reserveError } = await admin.rpc('pt_ai_reserve', {
    p_user_id: userId,
    p_day: day,
    p_input_tokens: reservedInput,
    p_output_tokens: reservedOutput,
    p_cost_micros: reservedCost,
    p_rate_limit: limits.rate,
    p_user_request_limit: limits.userRequests,
    p_user_token_limit: limits.userTokens,
    p_global_request_limit: limits.globalRequests,
    p_global_token_limit: limits.globalTokens,
    p_spend_cap_micros: spendCapMicros,
  });
  if (reserveError || !reservationId) return quotaFailure(req, reserveError);

  const settle = async (inputTokens: number, outputTokens: number, costMicros: number) => {
    // Settlement failure leaves the conservative reservation in place; it never disables future limits.
    await admin.rpc('pt_ai_settle', {
      p_reservation_id: reservationId,
      p_actual_input_tokens: inputTokens,
      p_actual_output_tokens: outputTokens,
      p_actual_cost_micros: costMicros,
    });
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), limits.timeoutMs);
  const abort = () => controller.abort();
  req.signal.addEventListener('abort', abort, { once: true });
  try {
    const response = await fetch(`${BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: { authorization: `Bearer ${API_KEY}`, 'content-type': 'application/json' },
      body: JSON.stringify(toProviderBody(input, MODEL, system)),
      signal: controller.signal,
    });
    const responseText = await response.text();
    if (responseText.length > 1_000_000) {
      await settle(reservedInput, reservedOutput, reservedCost).catch(() => undefined);
      return fail(req, 502, 'provider_response_too_large', 'The provider returned an oversized response. No tracker record was written by the relay.');
    }
    if (!response.ok) {
      await settle(0, 0, 0).catch(() => undefined);
      return providerFailure(req, response.status);
    }
    let providerBody: unknown;
    try {
      providerBody = JSON.parse(responseText);
    } catch {
      throw new ProviderCompatibilityError('The provider returned invalid JSON.');
    }
    const output = parseProviderOutput(providerBody, MODEL);
    const actualInput = output.usage?.inputTokens ?? reservedInput;
    const actualOutput = output.usage?.outputTokens ?? reservedOutput;
    const actualCost = usageCostMicros(actualInput, actualOutput, inputPrice, outputPrice);
    await settle(actualInput, actualOutput, actualCost).catch(() => undefined);
    return json(req, 200, output);
  } catch (error) {
    // A timeout/network/parse outcome is uncertain, so keep the upper-bound reservation.
    await settle(reservedInput, reservedOutput, reservedCost).catch(() => undefined);
    if (error instanceof ProviderCompatibilityError) return fail(req, 502, 'provider_incompatible', 'The configured provider returned an incompatible response. Choose a model with chat and tool support.');
    if (controller.signal.aborted) return fail(req, 504, 'provider_timeout', 'The AI provider took too long. Try again.');
    return fail(req, 502, 'provider_unavailable', 'The default AI provider could not be reached. Try again or use your own model.');
  } finally {
    clearTimeout(timer);
    req.signal.removeEventListener('abort', abort);
  }
});
