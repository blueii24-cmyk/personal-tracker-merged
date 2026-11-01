import type { AiProviderId } from '../lib/ai/provider';

export type AiChatRequest = {
  sessionId?: string;
  /** Generate once per submitted UI message and reuse for retries. */
  clientMessageId: string;
  message: string;
  providerId?: AiProviderId;
  modelId?: string;
};

export type AiActionStatus = 'succeeded' | 'needs_clarification' | 'rejected' | 'failed';

export type AiActionResult = {
  toolCallId: string;
  toolName: string;
  status: AiActionStatus;
  summary: string;
  recordIds?: string[];
  data?: Record<string, unknown>;
};

export type AiChatResponse = {
  sessionId: string;
  userMessageId: string;
  assistantMessageId: string;
  assistantMessage: string;
  actions: AiActionResult[];
  dashboardInvalidation: Array<'nutrition' | 'finance' | 'weight' | 'history'>;
  provider: AiProviderId;
  model: string;
};

export type ApiError = {
  error: {
    code: string;
    message: string;
    retryable: boolean;
    requestId: string;
  };
};
