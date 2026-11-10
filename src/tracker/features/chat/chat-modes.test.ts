// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
import { MockTrackerService } from '@/tracker/lib/api/mock/mock-tracker-service';
import { normalizeSession } from '@/tracker/lib/api/mock/persistence';
import { runByokChat } from '@/tracker/lib/ai/byok/run-chat';
import { DEFAULT_CONFIG } from '@/tracker/lib/ai/byok/config';
import type { AiProviderAdapter, ProviderGenerateInput } from '@/tracker/lib/ai/provider';
import { casualContext } from '@/tracker/lib/ai/casual-context';
import { fromRow, toRow } from '@/tracker/sync/mapping';
import { ChatProvider, useChat } from './ChatProvider';

afterEach(() => { cleanup(); localStorage.clear(); vi.restoreAllMocks(); });
const now = new Date('2026-10-30T10:30:00Z');
const config = { ...DEFAULT_CONFIG, providerId: 'openai' as const, model: 'test-model', notes: 'private note' };

describe('session chat modes', () => {
  it('defaults old sessions to log and maps casual mode across cloud rows', () => {
    const session = { id: 's', title: 'Old', createdAt: now.toISOString(), updatedAt: now.toISOString() };
    expect(normalizeSession(session)?.mode).toBe('log');
    const row = toRow('chatSession', { ...session, mode: 'casual' }, { baseRev: 0, updatedAt: now.toISOString(), deleted: false }, 'u');
    expect(row.chat_mode).toBe('casual');
    expect(fromRow('chatSession', row)).toMatchObject({ mode: 'casual' });
    expect(fromRow('chatSession', { ...row, chat_mode: undefined })).toMatchObject({ mode: 'log' });
  });

  it('persists casual sessions, prevents mixed modes, and keeps mentioned records untouched across reload', async () => {
    const service = new MockTrackerService(() => now);
    const reply = await service.sendChatMessage({ mode: 'casual', clientMessageId: '1', message: 'I had chicken rice and spent ₹200' });
    expect(reply.actions).toEqual([]);
    expect(await service.getMeals()).toEqual([]);
    expect(await service.getTransactions()).toEqual([]);
    const reloaded = new MockTrackerService(() => now);
    expect((await reloaded.getChatSessions())[0]?.mode).toBe('casual');
    expect(await reloaded.getChatHistory(reply.sessionId)).toHaveLength(2);
    await expect(reloaded.sendChatMessage({ mode: 'log', sessionId: reply.sessionId, clientMessageId: '2', message: 'log weight 60 kg' })).rejects.toMatchObject({ code: 'INVALID_REQUEST' });
    expect(await reloaded.getWeighIns()).toEqual([]);
  });

  it('never runs unsolicited BYOK mutation calls in casual mode', async () => {
    const svc = new MockTrackerService(() => now);
    let sent: ProviderGenerateInput | undefined;
    const adapter: AiProviderAdapter = { providerId: 'openai', async generate(input) { sent = input; return { text: 'Saved', finishReason: 'tool_calls', toolCalls: [{ id: 'x', name: 'log_weight', arguments: { weight_kg: 60 } }] }; } };
    await expect(runByokChat({ service: svc, config, input: { mode: 'casual', clientMessageId: 'bad', message: 'Log my weight' }, adapter })).rejects.toMatchObject({ code: 'AI_ENDPOINT_ERROR' });
    expect(sent?.tools).toEqual([]);
    expect(await svc.getWeighIns()).toEqual([]);
    expect(await svc.getChatSessions()).toEqual([]);
  });

  it('sends a read-only progress summary and persists a tool-free casual answer', async () => {
    const svc = new MockTrackerService(() => now);
    await svc.createWeighIn({ weightKg: 70, recordedAt: now.toISOString(), notes: null });
    let sent: ProviderGenerateInput | undefined;
    const adapter: AiProviderAdapter = { providerId: 'openai', async generate(input) { sent = input; return { text: 'Your latest recorded weight is 70 kg.', finishReason: 'stop', toolCalls: [] }; } };
    const reply = await runByokChat({ service: svc, config, input: { mode: 'casual', clientMessageId: 'answer', message: 'How is my weight?' }, adapter });
    expect(reply.assistantMessage).toContain('70 kg');
    expect(sent?.tools).toEqual([]);
    expect(sent?.system).toContain('Latest weight: 70 kg');
    expect(sent?.system).not.toContain('private note');
    expect(sent?.relayContext).toMatchObject({ mode: 'casual', notes: '', settings: { monthlyBudget: null } });
    expect((await svc.getChatSessions())[0]?.mode).toBe('casual');
    expect(await svc.getWeighIns()).toHaveLength(1);
  });

  it('supplies only requested aggregates and does not invent missing readings', async () => {
    const svc = new MockTrackerService(() => now);
    const settings = await svc.getUserSettings();
    expect(await casualContext(svc, 'I had a rough day', settings)).toContain('No tracker summary');
    const weight = await casualContext(svc, 'How is my weight?', settings);
    expect(weight).toContain('No weight readings are available');
    expect(weight).not.toContain('expenses');
    expect(weight).not.toContain('private note');
  });

  it('does not switch while a message is processing or duplicate a send', async () => {
    const service = new MockTrackerService(() => now);
    let api: ReturnType<typeof useChat> | undefined;
    function Capture() { api = useChat(); return null; }
    let finish!: (value: Awaited<ReturnType<typeof service.sendChatMessage>>) => void;
    const sender = vi.fn(() => new Promise<Awaited<ReturnType<typeof service.sendChatMessage>>>((resolve) => { finish = resolve; }));
    // eslint-disable-next-line react/no-children-prop
    render(createElement(ChatProvider, { service, onRecordsChanged: async () => {}, sender, children: createElement(Capture) }));
    act(() => { api!.changeMode('casual'); api!.send('hello'); api!.send('hello'); api!.changeMode('log'); });
    expect(api!.mode).toBe('casual');
    expect(sender).toHaveBeenCalledOnce();
    const reply = await service.sendChatMessage({ mode: 'casual', clientMessageId: 'test', message: 'hello' });
    await act(async () => finish(reply));
    expect(api!.messages).toHaveLength(2);
    expect(api!.mode).toBe('casual');
  });

  it('switches to a separate conversation and restores its original mode', async () => {
    const service = new MockTrackerService(() => now);
    const prior = await service.sendChatMessage({ mode: 'casual', clientMessageId: 'c', message: 'Hello' });
    let api: ReturnType<typeof useChat> | undefined;
    function Capture() { api = useChat(); return null; }
    // eslint-disable-next-line react/no-children-prop
    render(createElement(ChatProvider, { service, onRecordsChanged: async () => {}, children: createElement(Capture) }));
    expect(api!.mode).toBe('log');
    act(() => api!.openSession(prior.sessionId));
    await waitFor(() => expect(api!.messages).toHaveLength(2));
    expect(api!.mode).toBe('casual');
    vi.spyOn(window, 'confirm').mockReturnValue(true);
    act(() => api!.changeMode('log'));
    expect(api!.mode).toBe('log');
    expect(api!.messages).toEqual([]);
    expect(await service.getChatHistory(prior.sessionId)).toHaveLength(2);
    act(() => api!.openSession(prior.sessionId));
    await waitFor(() => expect(api!.messages).toHaveLength(2));
    expect(api!.mode).toBe('casual');
  });
});
