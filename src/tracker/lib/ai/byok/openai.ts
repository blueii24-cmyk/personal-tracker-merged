import type { AiProviderAdapter, AiProviderId, CanonicalMessage, ProviderGenerateInput, ProviderGenerateOutput } from '../provider';
import { parseArgs, postJson } from './http';

export const OPENAI_BASE_URL = 'https://api.openai.com/v1';

/** Accepts "https://host/v1", "https://host/v1/", or a pasted ".../chat/completions" and returns the base. */
export function normalizeBaseUrl(raw: string): string {
  return raw.trim().replace(/\/+$/, '').replace(/\/chat\/completions$/i, '');
}

type OaMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string };

export function toOpenAiMessages(system: string, messages: CanonicalMessage[]): OaMessage[] {
  const out: OaMessage[] = [{ role: 'system', content: system }];
  for (const m of messages) {
    if (m.role === 'tool') out.push({ role: 'tool', tool_call_id: m.toolCallId, content: m.content });
    else if (m.role === 'assistant') {
      out.push({
        role: 'assistant',
        content: m.content || null,
        ...(m.toolCalls?.length
          ? { tool_calls: m.toolCalls.map((c) => ({ id: c.id, type: 'function' as const, function: { name: c.name, arguments: JSON.stringify(c.arguments) } })) }
          : {}),
      });
    } else out.push({ role: m.role, content: m.content });
  }
  return out;
}

interface OaResponse {
  id?: string;
  choices?: Array<{
    finish_reason?: string | null;
    message?: { content?: string | Array<{ type?: string; text?: string }> | null; tool_calls?: Array<{ id?: string; function?: { name?: string; arguments?: unknown } }> };
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

export class OpenAiAdapter implements AiProviderAdapter {
  readonly providerId: AiProviderId;
  private readonly apiKey: string;
  private readonly baseUrl: string;
  constructor(apiKey: string, baseUrl: string, compatible: boolean) {
    this.apiKey = apiKey;
    this.baseUrl = baseUrl;
    this.providerId = compatible ? 'openai-compatible' : 'openai';
  }

  async generate(input: ProviderGenerateInput): Promise<ProviderGenerateOutput> {
    const official = this.providerId === 'openai';
    const body: Record<string, unknown> = {
      model: input.model,
      messages: toOpenAiMessages(input.system, input.messages),
    };
    // OpenAI's newer models reject `max_tokens`; most third-party servers only understand it.
    if (input.maxOutputTokens) body[official ? 'max_completion_tokens' : 'max_tokens'] = input.maxOutputTokens;
    if (input.tools.length) {
      body.tools = input.tools.map((t) => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.inputSchema } }));
      body.tool_choice = 'auto';
    }
    const { data, requestId } = await postJson<OaResponse>({
      url: `${this.baseUrl}/chat/completions`,
      headers: { authorization: `Bearer ${this.apiKey}` },
      body,
      apiKey: this.apiKey,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      providerLabel: official ? 'OpenAI' : 'The model server',
      notFoundMeansModel: official,
      model: input.model,
    });

    const choice = data.choices?.[0];
    const content = choice?.message?.content;
    const text = typeof content === 'string' ? content : Array.isArray(content) ? content.map((p) => p.text ?? '').join('') : '';
    const toolCalls = (choice?.message?.tool_calls ?? []).map((c, i) => ({
      id: c.id || `call_${i + 1}`,
      name: c.function?.name ?? '',
      arguments: parseArgs(c.function?.arguments),
    }));
    const reason = choice?.finish_reason;
    return {
      text: text.trim(),
      toolCalls,
      finishReason: toolCalls.length ? 'tool_calls' : reason === 'length' ? 'length' : reason === 'content_filter' ? 'provider_error' : 'stop',
      usage: { inputTokens: data.usage?.prompt_tokens, outputTokens: data.usage?.completion_tokens },
      providerRequestId: requestId ?? data.id,
    };
  }
}
