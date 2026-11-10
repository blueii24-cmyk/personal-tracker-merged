/** Provider-neutral contract. Provider adapters translate this format to/from each vendor's native API. */

export type AiProviderId = 'openai' | 'anthropic' | 'gemini' | 'openai-compatible';

export type CanonicalToolCall = {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
  /** Opaque vendor data that must be echoed back on the next turn (e.g. Gemini thought signatures). */
  providerMeta?: unknown;
};

export type CanonicalMessage =
  | { role: 'system' | 'user' | 'assistant'; content: string; toolCalls?: CanonicalToolCall[] }
  | { role: 'tool'; toolCallId: string; name: string; content: string };

export type CanonicalToolDefinition = {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
};

export type ProviderGenerateInput = {
  model: string;
  system: string;
  messages: CanonicalMessage[];
  tools: CanonicalToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
  timeoutMs?: number;
  /** Cancels the in-flight HTTP request. */
  signal?: AbortSignal;
  /** Authenticated default relay only; BYOK adapters ignore this. */
  relayContext?: {
    settings: Pick<import('../../types/domain').UserSettings, 'timezone' | 'dailyCalorieTarget' | 'dailyProteinTargetG' | 'monthlyBudget' | 'targetWeightKg' | 'weightUnit'>;
    notes: string;
    mode?: import('../../types/domain').ChatMode;
    progress?: string;
  };
};

export type ProviderGenerateOutput = {
  text: string;
  toolCalls: CanonicalToolCall[];
  finishReason: 'stop' | 'tool_calls' | 'length' | 'provider_error';
  usage?: { inputTokens?: number; outputTokens?: number };
  providerRequestId?: string;
  /** Actual configured model, when supplied by an authenticated relay. */
  model?: string;
};

export interface AiProviderAdapter {
  readonly providerId: AiProviderId;
  generate(input: ProviderGenerateInput): Promise<ProviderGenerateOutput>;
}

/**
 * Registry rule: provider/model combinations must be server-allowlisted.
 * Never accept an arbitrary base URL from the browser (SSRF risk).
 */
export type ProviderRegistry = Partial<Record<AiProviderId, AiProviderAdapter>>;
