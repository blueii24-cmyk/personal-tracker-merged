import type { AiProviderAdapter, CanonicalMessage, ProviderGenerateInput, ProviderGenerateOutput } from '../provider';
import { postJson } from './http';

export const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

type Block =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; tool_use_id: string; content: string };
type AMessage = { role: 'user' | 'assistant'; content: string | Block[] };

/** Tool results must travel together in one user turn, so consecutive `tool` messages are merged. */
export function toAnthropicMessages(messages: CanonicalMessage[]): AMessage[] {
  const out: AMessage[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue; // the system prompt is a top-level field
    if (m.role === 'tool') {
      const block: Block = { type: 'tool_result', tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && Array.isArray(last.content) && last.content.every((b) => b.type === 'tool_result')) last.content.push(block);
      else out.push({ role: 'user', content: [block] });
    } else if (m.role === 'assistant') {
      const blocks: Block[] = [];
      if (m.content.trim()) blocks.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls ?? []) blocks.push({ type: 'tool_use', id: c.id, name: c.name, input: c.arguments });
      if (blocks.length) out.push({ role: 'assistant', content: blocks });
    } else out.push({ role: 'user', content: m.content });
  }
  return out;
}

interface AResponse {
  id?: string;
  stop_reason?: string | null;
  content?: Array<{ type: string; text?: string; id?: string; name?: string; input?: unknown }>;
  usage?: { input_tokens?: number; output_tokens?: number };
}

export class AnthropicAdapter implements AiProviderAdapter {
  readonly providerId = 'anthropic' as const;
  private readonly apiKey: string;
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generate(input: ProviderGenerateInput): Promise<ProviderGenerateOutput> {
    const body: Record<string, unknown> = {
      model: input.model,
      max_tokens: input.maxOutputTokens ?? 1500,
      system: input.system,
      messages: toAnthropicMessages(input.messages),
    };
    if (input.tools.length) body.tools = input.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.inputSchema }));
    const { data, requestId } = await postJson<AResponse>({
      url: ANTHROPIC_URL,
      headers: {
        'x-api-key': this.apiKey,
        'anthropic-version': '2023-06-01',
        // Required by Anthropic for calls made straight from a browser.
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body,
      apiKey: this.apiKey,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      providerLabel: 'Anthropic',
      notFoundMeansModel: true,
      model: input.model,
    });

    const blocks = data.content ?? [];
    const text = blocks.filter((b) => b.type === 'text').map((b) => b.text ?? '').join('').trim();
    const toolCalls = blocks
      .filter((b) => b.type === 'tool_use')
      .map((b, i) => ({
        id: b.id || `toolu_${i + 1}`,
        name: b.name ?? '',
        arguments: b.input && typeof b.input === 'object' && !Array.isArray(b.input) ? (b.input as Record<string, unknown>) : {},
      }));
    return {
      text,
      toolCalls,
      finishReason: toolCalls.length ? 'tool_calls' : data.stop_reason === 'max_tokens' ? 'length' : data.stop_reason === 'refusal' ? 'provider_error' : 'stop',
      usage: { inputTokens: data.usage?.input_tokens, outputTokens: data.usage?.output_tokens },
      providerRequestId: requestId ?? data.id,
    };
  }
}
