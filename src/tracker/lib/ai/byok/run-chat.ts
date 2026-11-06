import { AI_TOOLS } from '../tool-schemas';
import type { AiProviderAdapter, CanonicalMessage } from '../provider';
import { isAbortError, TrackerError, toTrackerError } from '@/tracker/lib/api/errors';
import type { ChatReply, TrackerService } from '@/tracker/lib/api/tracker-service';
import type { AiActionResult, AiChatRequest } from '@/tracker/types/api';
import type { ChatMessage } from '@/tracker/types/domain';
import { createAdapter, type ByokConfig } from './config';
import { buildSystemPrompt } from './system-prompt';
import { executeTool, isWriteTool, type Invalidation, type ToolOutcome } from './tools';
import { editContext, EDIT_NOTICE } from '@/tracker/features/chat/edit-safety';

export const MAX_ROUNDS = 6;
export const MAX_TOOL_CALLS = 12;
export const MAX_WRITES = 8;
const HISTORY_MESSAGES = 12;
const MAX_OUTPUT_TOKENS = 1500;

export interface RunChatArgs {
  service: TrackerService;
  config: ByokConfig;
  apiKey?: string;
  input: AiChatRequest;
  signal?: AbortSignal;
  now?: () => Date;
  /** Test seam: replaces the real HTTP adapter. */
  adapter?: AiProviderAdapter;
}

function historyToCanonical(history: ChatMessage[]): CanonicalMessage[] {
  return history
    .filter((m) => m.status === 'complete' && m.content.trim())
    .slice(-HISTORY_MESSAGES)
    .map((m): CanonicalMessage => {
      if (m.role === 'user') return { role: 'user', content: m.editOfMessageId ? `[Correction to an earlier message; no records were changed] ${m.content}` : m.content };
      const saved = (m.actions ?? []).filter((a) => a.status === 'succeeded' && a.recordIds?.length).map((a) => a.summary);
      return { role: 'assistant', content: saved.length ? `${m.content}\n(Saved: ${saved.join('; ')})` : m.content };
    });
}

/** Keep the receipt cards honest: hide lookups, and hide failed attempts the model later fixed. */
function visibleActions(all: Array<AiActionResult & { name: string }>): AiActionResult[] {
  return all
    .filter((a, i) => {
      if (a.name === 'search_entries') return false;
      if (a.status === 'succeeded') return true;
      return !all.slice(i + 1).some((later) => later.name === a.name && later.status === 'succeeded');
    })
    .map(({ name: _n, ...a }) => a);
}

function fallbackText(actions: AiActionResult[], reason: string): string {
  const saved = actions.filter((a) => a.status === 'succeeded' && a.recordIds?.length).map((a) => a.summary);
  return saved.length ? `Saved: ${saved.join('; ')}. ${reason}` : reason;
}

/**
 * One chat turn answered by BYOK or the authenticated default relay. The model only ever sees the built-in
 * rules, the eight tracker tools and the user's notes; every tool argument is validated here before anything is written.
 */
export async function runByokChat(args: RunChatArgs): Promise<ChatReply> {
  const { service, config, apiKey, input, signal } = args;
  const clock = args.now ?? (() => new Date());
  const message = input.message.trim();
  if (!message) throw new TrackerError('INVALID_REQUEST', 'Write a message first.', { retryable: false });
  if (message.length > 4000) throw new TrackerError('INVALID_REQUEST', 'Keep messages under 4,000 characters.', { retryable: false });

  // A retried submit must never repeat saved actions.
  const prior = await service.findChatReply(input.clientMessageId);
  if (prior) return prior;

  const adapter = args.adapter ?? createAdapter(config, apiKey ?? '');
  const settings = await service.getUserSettings();
  const history = input.sessionId ? await service.getChatHistory(input.sessionId) : [];
  if (input.editOfMessageId && !input.sessionId) throw new TrackerError('INVALID_REQUEST', 'A correction needs an existing conversation.', { retryable: false });
  const edit = input.editOfMessageId ? editContext(history, input.editOfMessageId) : null;
  const system = buildSystemPrompt(settings, clock(), config.notes);
  const prompt = edit
    ? `Correction to an earlier message (the original and all later turns remain in the conversation). Original: ${JSON.stringify(edit.original.content)}\nCorrected message: ${message}\n${edit.savedActions ? 'The original turn already saved records; do not repeat or undo them.' : 'Earlier turns and records are unchanged.'} This correction is read-only: do not claim to save or change records.`
    : message;
  const messages: CanonicalMessage[] = [...historyToCanonical(history), { role: 'user', content: prompt }];

  const done: Array<AiActionResult & { name: string }> = [];
  const invalidation = new Set<Invalidation>();
  const seenWrites = new Map<string, ToolOutcome>();
  let writes = 0;
  let calls = 0;
  let finalText = '';
  let responseModel = config.model.trim();
  let interrupted: string | null = null;
  let editWriteBlocked = false;

  try {
    for (let round = 0; round < MAX_ROUNDS; round++) {
      const out = await adapter.generate({
        model: config.model.trim(), system, messages, tools: AI_TOOLS, maxOutputTokens: MAX_OUTPUT_TOKENS, signal,
        relayContext: {
          settings: {
            timezone: settings.timezone,
            dailyCalorieTarget: settings.dailyCalorieTarget,
            dailyProteinTargetG: settings.dailyProteinTargetG,
            monthlyBudget: settings.monthlyBudget,
            targetWeightKg: settings.targetWeightKg,
            weightUnit: settings.weightUnit,
          },
          notes: config.notes,
        },
      });
      if (out.model) responseModel = out.model;
      if (!out.toolCalls.length) {
        if (out.finishReason === 'provider_error' && !out.text) throw new TrackerError('PROVIDER_UNAVAILABLE', 'The model declined to answer that.', { retryable: true });
        if (out.finishReason === 'length' && !out.text) throw new TrackerError('PROVIDER_UNAVAILABLE', 'The model ran out of room before replying. Try a shorter message.', { retryable: true });
        finalText = out.text;
        break;
      }
      messages.push({ role: 'assistant', content: out.text, toolCalls: out.toolCalls });
      for (const call of out.toolCalls) {
        let outcome: ToolOutcome;
        const key = isWriteTool(call.name) ? `${call.name}:${JSON.stringify(call.arguments)}` : null;
        // Fail closed for edits: only explicitly read-only tools are allowed, including if new tools are added later.
        if (edit && call.name !== 'get_summary' && call.name !== 'search_entries') {
          calls++;
          editWriteBlocked = true;
          outcome = { status: 'rejected', summary: 'Corrections cannot change records', modelContent: { ok: false, error: 'This correction is read-only. No record was changed. Ask the user to review their records before a separate change.' }, write: false, invalidation: [] };
        } else if (calls >= MAX_TOOL_CALLS) {
          outcome = { status: 'rejected', summary: 'Too many tool calls in one message.', modelContent: { ok: false, error: 'Tool call limit reached. Reply to the user now.' }, write: false, invalidation: [] };
        } else if (isWriteTool(call.name) && writes >= MAX_WRITES) {
          outcome = { status: 'rejected', summary: 'Too many changes in one message.', modelContent: { ok: false, error: 'Change limit reached for one message. Tell the user what is done and ask them to send the rest separately.' }, write: false, invalidation: [] };
        } else if (key && seenWrites.has(key)) {
          const first = seenWrites.get(key)!;
          messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify({ ...first.modelContent, duplicate: true, note: 'Identical call already saved in this message; nothing new was written.' }) });
          continue;
        } else {
          calls++;
          outcome = await executeTool(call.name, call.arguments, { service, settings, now: clock() });
          if (outcome.write) writes++;
          if (key && outcome.status === 'succeeded') seenWrites.set(key, outcome);
        }
        outcome.invalidation.forEach((i) => invalidation.add(i));
        done.push({
          toolCallId: call.id, toolName: call.name, name: call.name, status: outcome.status, summary: outcome.summary,
          ...(outcome.recordIds ? { recordIds: outcome.recordIds } : {}),
          ...(outcome.payload ? { data: outcome.payload as unknown as Record<string, unknown> } : {}),
        });
        messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content: JSON.stringify(outcome.modelContent) });
      }
    }
  } catch (e) {
    const err = toTrackerError(e);
    const wroteSomething = done.some((a) => a.status === 'succeeded' && a.recordIds?.length);
    // Records already exist, so surface them instead of an error that would invite a duplicating retry.
    if (!wroteSomething) throw err;
    interrupted = isAbortError(e) ? 'You stopped me before I could finish replying.' : `I lost the model's reply before it finished (${err.message}).`;
  }

  const actions = visibleActions(done);
  let assistantMessage = finalText.trim();
  if (interrupted) assistantMessage = fallbackText(actions, interrupted);
  else if (editWriteBlocked) assistantMessage = 'I could not apply a record change while regenerating this correction.';
  else if (!assistantMessage) {
    // Nothing was saved and there is no answer to show: let the user retry rather than show an empty turn.
    if (!actions.some((x) => x.status === 'succeeded' && x.recordIds?.length)) {
      throw new TrackerError('PROVIDER_UNAVAILABLE', 'The model did not give an answer. Try again, or rephrase your message.', { retryable: true });
    }
    assistantMessage = fallbackText(actions, "I didn't get a written reply from the model, but that is what was done.");
  }

  // The model may still claim success after a rejected tool call; never display that claim as a receipt.
  if (editWriteBlocked) assistantMessage = 'I could not apply a record change while regenerating this correction.';

  return service.recordChatExchange({
    sessionId: input.sessionId,
    clientMessageId: input.clientMessageId,
    userMessage: message,
    editOfMessageId: input.editOfMessageId,
    assistantMessage: edit ? `${assistantMessage}\n\n${EDIT_NOTICE}` : assistantMessage,
    actions,
    dashboardInvalidation: [...invalidation],
    provider: config.providerId,
    model: responseModel,
  });
}

/** A tiny real request so a wrong key, model or address shows up now rather than in the middle of a chat. */
export async function testConnection(config: ByokConfig, apiKey: string, signal?: AbortSignal, adapter?: AiProviderAdapter): Promise<{ ms: number }> {
  const a = adapter ?? createAdapter(config, apiKey);
  const started = performance.now();
  await a.generate({
    model: config.model.trim(),
    system: 'Reply with the single word OK.',
    messages: [{ role: 'user', content: 'ping' }],
    tools: [],
    maxOutputTokens: 32,
    timeoutMs: 20_000,
    signal,
  });
  return { ms: Math.round(performance.now() - started) };
}
