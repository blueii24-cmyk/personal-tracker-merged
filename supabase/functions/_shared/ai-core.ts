/**
 * Pure default-AI relay validation and OpenAI-compatible translation.
 * No provider credentials, network calls, tracker writes, or Deno globals here.
 */
import { AI_TOOLS } from '../../../src/tracker/lib/ai/tool-schemas.ts';
import { buildSystemPrompt } from '../../../src/tracker/lib/ai/byok/system-prompt.ts';
import type { CanonicalMessage, CanonicalToolCall, ProviderGenerateOutput } from '../../../src/tracker/lib/ai/provider.ts';
import type { UserSettings } from '../../../src/tracker/types/domain.ts';

export const DEFAULT_AI_MAX_BODY_BYTES = 100_000;
export const DEFAULT_AI_MAX_MESSAGES = 48;
export const DEFAULT_AI_MAX_OUTPUT_TOKENS = 1500;
export const DEFAULT_AI_MAX_TOOL_CALLS = 12;
export const DEFAULT_AI_MAX_NOTES = 800;
const ALLOWED_TOOLS = new Set(AI_TOOLS.map((tool) => tool.name));

export class AiRequestError extends Error {}
export class ProviderCompatibilityError extends Error {}

const record = (value: unknown): Record<string, unknown> | null =>
  value !== null && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;

const text = (value: unknown, max: number): string | null =>
  typeof value === 'string' && value.length <= max ? value : null;

function nullableNumber(value: unknown, max: number): number | null {
  if (value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > max) throw new AiRequestError('Invalid tracker context.');
  return value;
}

function settingsFrom(value: unknown): UserSettings {
  const input = record(value);
  if (!input) throw new AiRequestError('Invalid tracker context.');
  const timezone = text(input.timezone, 100);
  if (!timezone) throw new AiRequestError('Invalid tracker context.');
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone }).format(new Date(0));
  } catch {
    throw new AiRequestError('Invalid tracker context.');
  }
  if (input.weightUnit !== 'kg' && input.weightUnit !== 'lb') throw new AiRequestError('Invalid tracker context.');
  return {
    // Identity and opening balance are deliberately not sent to the relay.
    displayName: '', email: '', currency: 'INR', openingBalance: 0,
    preferredAiProvider: 'demo', preferredAiModel: null,
    timezone,
    dailyCalorieTarget: nullableNumber(input.dailyCalorieTarget, 100_000),
    dailyProteinTargetG: nullableNumber(input.dailyProteinTargetG, 10_000),
    monthlyBudget: nullableNumber(input.monthlyBudget, 100_000_000),
    targetWeightKg: nullableNumber(input.targetWeightKg, 1000),
    weightUnit: input.weightUnit,
  };
}

function toolCall(value: unknown): CanonicalToolCall {
  const input = record(value);
  const id = text(input?.id, 200);
  const name = text(input?.name, 80);
  const args = record(input?.arguments);
  if (!input || !id || !name || !ALLOWED_TOOLS.has(name) || !args) throw new AiRequestError('Invalid tool call.');
  return { id, name, arguments: args };
}

function messageFrom(value: unknown): CanonicalMessage {
  const input = record(value);
  if (!input) throw new AiRequestError('Invalid messages.');
  const content = text(input.content, 20_000);
  if (content === null) throw new AiRequestError('Invalid messages.');
  if (input.role === 'user') return { role: 'user', content };
  if (input.role === 'assistant') {
    if (input.toolCalls === undefined) return { role: 'assistant', content };
    if (!Array.isArray(input.toolCalls) || input.toolCalls.length > DEFAULT_AI_MAX_TOOL_CALLS) throw new AiRequestError('Too many tool calls.');
    return { role: 'assistant', content, toolCalls: input.toolCalls.map(toolCall) };
  }
  if (input.role === 'tool') {
    const toolCallId = text(input.toolCallId, 200);
    const name = text(input.name, 80);
    if (!toolCallId || !name || !ALLOWED_TOOLS.has(name)) throw new AiRequestError('Invalid tool result.');
    return { role: 'tool', toolCallId, name, content };
  }
  throw new AiRequestError('Invalid messages.');
}

export interface DefaultRelayInput {
  messages: CanonicalMessage[];
  settings: UserSettings;
  notes: string;
  maxOutputTokens: number;
}

/** The browser cannot choose a system prompt, provider, model, URL, or tool list. */
export function validateGenerateInput(value: unknown): DefaultRelayInput {
  const body = record(value);
  if (!body || !Array.isArray(body.messages) || body.messages.length < 1 || body.messages.length > DEFAULT_AI_MAX_MESSAGES) {
    throw new AiRequestError('Invalid or too many messages.');
  }
  const messages = body.messages.map(messageFrom);
  if (!messages.some((message) => message.role === 'user')) throw new AiRequestError('A user message is required.');
  const context = record(body.context);
  const notes = text(context?.notes, DEFAULT_AI_MAX_NOTES);
  if (!context || notes === null) throw new AiRequestError('Invalid tracker context.');
  const maxOutputTokens = body.maxOutputTokens;
  if (typeof maxOutputTokens !== 'number' || !Number.isInteger(maxOutputTokens) || maxOutputTokens < 1 || maxOutputTokens > DEFAULT_AI_MAX_OUTPUT_TOKENS) {
    throw new AiRequestError('Invalid output-token limit.');
  }
  return { messages, settings: settingsFrom(context.settings), notes, maxOutputTokens };
}

export function buildRelaySystem(input: DefaultRelayInput, now: Date): string {
  return buildSystemPrompt(input.settings, now, input.notes);
}

type OpenAiMessage =
  | { role: 'system' | 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }> }
  | { role: 'tool'; tool_call_id: string; content: string };

export function toProviderBody(input: DefaultRelayInput, model: string, system: string): Record<string, unknown> {
  const messages: OpenAiMessage[] = [{ role: 'system', content: system }];
  for (const message of input.messages) {
    if (message.role === 'tool') messages.push({ role: 'tool', tool_call_id: message.toolCallId, content: message.content });
    else if (message.role === 'assistant') {
      messages.push({
        role: 'assistant', content: message.content || null,
        ...(message.toolCalls?.length ? { tool_calls: message.toolCalls.map((call) => ({ id: call.id, type: 'function' as const, function: { name: call.name, arguments: JSON.stringify(call.arguments) } })) } : {}),
      });
    } else messages.push({ role: 'user', content: message.content });
  }
  return {
    model,
    messages,
    max_tokens: input.maxOutputTokens,
    tools: AI_TOOLS.map((tool) => ({ type: 'function', function: { name: tool.name, description: tool.description, parameters: tool.inputSchema } })),
    tool_choice: 'auto',
  };
}

function providerArguments(value: unknown): Record<string, unknown> {
  try {
    const parsed = typeof value === 'string' ? JSON.parse(value) : value;
    const args = record(parsed);
    if (!args) throw new Error('not an object');
    return args;
  } catch {
    throw new ProviderCompatibilityError('The provider returned invalid tool arguments.');
  }
}

export function parseProviderOutput(value: unknown, configuredModel: string): ProviderGenerateOutput {
  const body = record(value);
  const choices = body?.choices;
  if (!Array.isArray(choices) || !choices.length) throw new ProviderCompatibilityError('The provider returned no answer.');
  const choice = record(choices[0]);
  const message = record(choice?.message);
  if (!message) throw new ProviderCompatibilityError('The provider returned an incompatible answer.');
  const rawContent = message.content;
  const content = typeof rawContent === 'string'
    ? rawContent
    : Array.isArray(rawContent)
      ? rawContent.map((part) => text(record(part)?.text, 100_000) ?? '').join('')
      : '';
  const rawCalls = message.tool_calls ?? [];
  if (!Array.isArray(rawCalls) || rawCalls.length > DEFAULT_AI_MAX_TOOL_CALLS) throw new ProviderCompatibilityError('The provider returned too many tool calls.');
  const toolCalls = rawCalls.map((raw, index) => {
    const call = record(raw);
    const fn = record(call?.function);
    const name = text(fn?.name, 80);
    if (!name || !ALLOWED_TOOLS.has(name)) throw new ProviderCompatibilityError('The provider requested an unsupported tool.');
    return {
      id: text(call?.id, 200) ?? `call_${index + 1}`,
      name,
      arguments: providerArguments(fn?.arguments),
    };
  });
  const usage = record(body?.usage);
  const numberOrUndefined = (v: unknown) => typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : undefined;
  const finish = choice?.finish_reason;
  return {
    text: content.trim(),
    toolCalls,
    finishReason: toolCalls.length ? 'tool_calls' : finish === 'length' ? 'length' : finish === 'content_filter' ? 'provider_error' : 'stop',
    usage: { inputTokens: numberOrUndefined(usage?.prompt_tokens), outputTokens: numberOrUndefined(usage?.completion_tokens) },
    providerRequestId: text(body?.id, 200) ?? undefined,
    model: configuredModel,
  };
}

/** Conservative pre-provider reservation; actual provider usage settles it afterwards. */
export function estimateInputTokens(system: string, input: DefaultRelayInput): number {
  return Math.max(1, Math.ceil((system.length + JSON.stringify(input.messages).length) / 4));
}

/** With USD-per-million-token prices, token count × price is already micro-USD. */
export function usageCostMicros(inputTokens: number, outputTokens: number, inputPrice: number, outputPrice: number): number {
  if (inputPrice <= 0 && outputPrice <= 0) return 0;
  return Math.max(0, Math.ceil(inputTokens * inputPrice + outputTokens * outputPrice));
}
