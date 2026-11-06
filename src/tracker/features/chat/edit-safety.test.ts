import { describe, expect, it } from 'vitest';
import { MockTrackerService } from '@/tracker/lib/api/mock/mock-tracker-service';
import { DEFAULT_CONFIG } from '@/tracker/lib/ai/byok/config';
import { runByokChat } from '@/tracker/lib/ai/byok/run-chat';
import type { AiProviderAdapter, ProviderGenerateInput } from '@/tracker/lib/ai/provider';
import { editContext } from './edit-safety';

const service = () => new MockTrackerService();

describe('chat corrections', () => {
  it('keeps receipts and later turns, detects writes, and never replays a demo write on retries', async () => {
    const svc = service();
    const original = await svc.sendChatMessage({ clientMessageId: 'original', message: 'I spent ₹60 on tea' });
    await svc.sendChatMessage({ sessionId: original.sessionId, clientMessageId: 'later', message: 'How much did I spend today?' });
    const before = await svc.getChatHistory(original.sessionId);
    expect(editContext(before, original.userMessageId).savedActions).toBe(true);
    const input = { sessionId: original.sessionId, clientMessageId: 'edit-1', editOfMessageId: original.userMessageId, message: 'I spent ₹70 on tea' };
    const [edited, concurrent] = await Promise.all([svc.sendChatMessage(input), svc.sendChatMessage(input)]);
    expect(concurrent.assistantMessageId).toBe(edited.assistantMessageId);
    const retry = await svc.sendChatMessage(input);
    expect(retry.assistantMessageId).toBe(edited.assistantMessageId);
    expect(edited.assistantMessage).toContain('did not change or create any records');
    const records = await svc.getTransactions();
    expect(records).toHaveLength(1);
    expect(records[0]?.amount).toBe(60);
    const after = await svc.getChatHistory(original.sessionId);
    expect(after).toHaveLength(before.length + 2);
    for (const m of before) expect(after).toContainEqual(m);
    expect(after.find((m) => m.id === edited.userMessageId)).toMatchObject({ content: input.message, editOfMessageId: original.userMessageId });
  });

  it('answers a read-only correction and rejects nonexistent or assistant targets', async () => {
    const svc = service();
    const first = await svc.sendChatMessage({ clientMessageId: 'a', message: 'Hello' });
    const revision = await svc.sendChatMessage({ sessionId: first.sessionId, clientMessageId: 'b', editOfMessageId: first.userMessageId, message: 'How much did I spend today?' });
    expect(revision.assistantMessage).toContain('did not change or create any records');
    expect(revision.actions.some((a) => a.toolName === 'get_summary')).toBe(true);
    await expect(svc.sendChatMessage({ sessionId: first.sessionId, clientMessageId: 'c', editOfMessageId: first.assistantMessageId, message: 'test' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
  });

  it('blocks every model write tool, keeps context and returns the same reply on retry', async () => {
    const svc = service();
    const first = await svc.sendChatMessage({ clientMessageId: 'first', message: 'I spent ₹60 on tea' });
    await svc.sendChatMessage({ sessionId: first.sessionId, clientMessageId: 'next', message: 'Hello' });
    const calls: ProviderGenerateInput[] = [];
    const names = ['log_meal', 'add_money_transaction', 'log_weight', 'update_transaction', 'update_meal', 'update_weight'];
    const adapter: AiProviderAdapter = { providerId: 'openai', async generate(input) {
      calls.push(structuredClone(input));
      return calls.length === 1
        ? { text: '', toolCalls: names.map((name) => ({ id: name, name, arguments: {} })), finishReason: 'tool_calls' }
        : { text: 'Saved it!', toolCalls: [], finishReason: 'stop' };
    } };
    const input = { sessionId: first.sessionId, clientMessageId: 'revision', editOfMessageId: first.userMessageId, message: 'I spent ₹80 on tea' };
    const args = { service: svc, config: { ...DEFAULT_CONFIG, model: 'test' }, input, adapter };
    const reply = await runByokChat(args);
    expect(reply.actions.every((a) => a.status === 'rejected')).toBe(true);
    expect(reply.assistantMessage).not.toContain('Saved it!');
    expect(reply.assistantMessage).toContain('did not change or create any records');
    expect((await svc.getTransactions()).map((t) => t.amount)).toEqual([60]);
    expect(await svc.getMeals()).toHaveLength(0);
    expect(await svc.getWeighIns()).toHaveLength(0);
    const userPrompt = calls[0]!.messages.at(-1);
    expect(userPrompt?.content).toContain('I spent ₹60 on tea');
    expect(userPrompt?.content).toContain('already saved records');
    expect(calls[0]!.messages.some((m) => m.content === 'Hello')).toBe(true);
    const count = calls.length;
    expect((await runByokChat(args)).assistantMessageId).toBe(reply.assistantMessageId);
    expect(calls).toHaveLength(count);
  });
});
