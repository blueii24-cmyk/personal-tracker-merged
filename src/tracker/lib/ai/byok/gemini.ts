import { TrackerError } from '@/tracker/lib/api/errors';
import type { AiProviderAdapter, CanonicalMessage, ProviderGenerateInput, ProviderGenerateOutput } from '../provider';
import { postJson } from './http';

export const GEMINI_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta';

/** Gemini accepts only an OpenAPI subset, so keep what it understands and drop the rest. Our own validators still enforce the full schema. */
const KEEP = new Set(['type', 'description', 'enum', 'items', 'properties', 'required', 'minimum', 'maximum', 'minItems', 'maxItems', 'nullable']);
export function sanitizeSchema(schema: unknown): unknown {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema);
  if (!schema || typeof schema !== 'object') return schema;
  const src = schema as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (k === 'properties' && v && typeof v === 'object') {
      out.properties = Object.fromEntries(Object.entries(v as Record<string, unknown>).map(([name, sub]) => [name, sanitizeSchema(sub)]));
    } else if (k === 'format') {
      if (v === 'date-time') out.format = v;
    } else if (KEEP.has(k)) out[k] = k === 'items' ? sanitizeSchema(v) : v;
  }
  // An object with no properties is rejected; the update tools use that shape for "changes".
  if (out.type === 'object' && out.properties && Object.keys(out.properties as object).length === 0) delete out.properties;
  return out;
}

type Part = { text?: string; thought?: boolean; thoughtSignature?: string; functionCall?: { name: string; args?: Record<string, unknown>; id?: string }; functionResponse?: { name: string; response: Record<string, unknown> } };
type GContent = { role: 'user' | 'model'; parts: Part[] };

export function toGeminiContents(messages: CanonicalMessage[]): GContent[] {
  const out: GContent[] = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      let response: Record<string, unknown>;
      try {
        const v = JSON.parse(m.content);
        response = v && typeof v === 'object' && !Array.isArray(v) ? v : { result: v };
      } catch {
        response = { result: m.content };
      }
      const part: Part = { functionResponse: { name: m.name, response } };
      const last = out[out.length - 1];
      if (last && last.role === 'user' && last.parts.every((p) => p.functionResponse)) last.parts.push(part);
      else out.push({ role: 'user', parts: [part] });
    } else if (m.role === 'assistant') {
      const parts: Part[] = [];
      if (m.content.trim()) parts.push({ text: m.content });
      for (const c of m.toolCalls ?? []) {
        const sig = (c.providerMeta as { thoughtSignature?: string } | undefined)?.thoughtSignature;
        parts.push({ functionCall: { name: c.name, args: c.arguments }, ...(sig ? { thoughtSignature: sig } : {}) });
      }
      if (parts.length) out.push({ role: 'model', parts });
    } else out.push({ role: 'user', parts: [{ text: m.content }] });
  }
  return out;
}

interface GResponse {
  candidates?: Array<{ finishReason?: string; content?: { parts?: Part[] } }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
  responseId?: string;
}

export class GeminiAdapter implements AiProviderAdapter {
  readonly providerId = 'gemini' as const;
  private readonly apiKey: string;
  constructor(apiKey: string) {
    this.apiKey = apiKey;
  }

  async generate(input: ProviderGenerateInput): Promise<ProviderGenerateOutput> {
    const body: Record<string, unknown> = {
      systemInstruction: { parts: [{ text: input.system }] },
      contents: toGeminiContents(input.messages),
      generationConfig: { maxOutputTokens: input.maxOutputTokens ?? 2048 },
    };
    if (input.tools.length) {
      body.tools = [{ functionDeclarations: input.tools.map((t) => ({ name: t.name, description: t.description, parameters: sanitizeSchema(t.inputSchema) })) }];
      body.toolConfig = { functionCallingConfig: { mode: 'AUTO' } };
    }
    const model = input.model.replace(/^models\//, '');
    const { data, requestId } = await postJson<GResponse>({
      // The key travels in a header, not the URL, so it can't leak through logs or the address bar.
      url: `${GEMINI_BASE_URL}/models/${encodeURIComponent(model)}:generateContent`,
      headers: { 'x-goog-api-key': this.apiKey },
      body,
      apiKey: this.apiKey,
      signal: input.signal,
      timeoutMs: input.timeoutMs,
      providerLabel: 'Google Gemini',
      notFoundMeansModel: true,
      model,
    });

    if (data.promptFeedback?.blockReason) {
      throw new TrackerError('INVALID_REQUEST', `Gemini blocked this request (${data.promptFeedback.blockReason}).`, { retryable: false, requestId });
    }
    const cand = data.candidates?.[0];
    const parts = cand?.content?.parts ?? [];
    const text = parts.filter((p) => p.text && !p.thought).map((p) => p.text).join('').trim();
    const toolCalls = parts
      .filter((p) => p.functionCall)
      .map((p, i) => ({
        id: p.functionCall!.id || `call_${i + 1}`,
        name: p.functionCall!.name,
        arguments: p.functionCall!.args && typeof p.functionCall!.args === 'object' ? p.functionCall!.args : {},
        providerMeta: p.thoughtSignature ? { thoughtSignature: p.thoughtSignature } : undefined,
      }));
    const fr = cand?.finishReason;
    return {
      text,
      toolCalls,
      finishReason: toolCalls.length ? 'tool_calls' : fr === 'MAX_TOKENS' ? 'length' : fr && fr !== 'STOP' ? 'provider_error' : 'stop',
      usage: { inputTokens: data.usageMetadata?.promptTokenCount, outputTokens: data.usageMetadata?.candidatesTokenCount },
      providerRequestId: requestId ?? data.responseId,
    };
  }
}
