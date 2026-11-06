// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createElement, useState } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ChatMessage } from '@/tracker/components/chat/ChatMessage';
import { TrackerProvider } from '@/tracker/features/store/TrackerProvider';
import { ChatProvider, useChat, type ChatSender } from './ChatProvider';
import { MockTrackerService } from '@/tracker/lib/api/mock/mock-tracker-service';
import { TrackerError } from '@/tracker/lib/api/errors';

afterEach(() => { cleanup(); localStorage.clear(); });

it('blocks double submission, exposes errors and retries a correction with the same id and safety mode', async () => {
  const service = new MockTrackerService();
  const initial = await service.sendChatMessage({ clientMessageId: 'initial', message: 'I spent ₹50 on tea' });
  let api: ReturnType<typeof useChat> | undefined;
  function Capture() { api = useChat(); return null; }
  let rejectFirst!: (error: Error) => void;
  const sender = vi.fn<ChatSender>()
    .mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectFirst = reject; }))
    .mockImplementation((input, opts) => service.sendChatMessage(input, opts));
  // createElement's types require the provider's required children in the props object.
  // eslint-disable-next-line react/no-children-prop
  render(createElement(ChatProvider, { service, onRecordsChanged: async () => {}, sender, children: createElement(Capture) }));
  act(() => api!.openSession(initial.sessionId));
  await waitFor(() => expect(api!.messages).toHaveLength(2));
  act(() => {
    expect(api!.edit(initial.userMessageId, 'I spent ₹60 on tea')).toBe(true);
    expect(api!.edit(initial.userMessageId, 'I spent ₹60 on tea')).toBe(false);
  });
  expect(sender).toHaveBeenCalledTimes(1);
  expect(api!.sending).toBe(true);
  await act(async () => { rejectFirst(new TrackerError('NETWORK', 'Offline', { retryable: true })); });
  const failed = api!.messages.find((m) => m.editOfMessageId === initial.userMessageId)!;
  expect(failed.status).toBe('error');
  expect(failed.error?.message).toBe('Offline');
  act(() => api!.retry(failed.id));
  await waitFor(() => expect(api!.sending).toBe(false), { timeout: 4000 });
  expect(sender).toHaveBeenCalledTimes(2);
  expect(sender.mock.calls[1]![0]).toMatchObject({ clientMessageId: sender.mock.calls[0]![0].clientMessageId, editOfMessageId: initial.userMessageId });
  expect(api!.activeSessionId).not.toBe(initial.sessionId);
  expect(api!.messages[0]?.content).toBe('I spent ₹60 on tea');
  expect(api!.messages.some((m) => m.id === initial.userMessageId)).toBe(false);
  expect(api!.messages.at(-1)?.content).toContain('did not change or create any records');
  expect((await service.getChatHistory(initial.sessionId))[0]?.content).toBe('I spent ₹50 on tea');
  expect((await service.getTransactions()).map((t) => t.amount)).toEqual([50]);
});

it('edits and regenerates a completed conversation inline while preserving the original branch', async () => {
  const service = new MockTrackerService();
  const initial = await service.sendChatMessage({ clientMessageId: 'completed-turn', message: 'Hello' });
  let api: ReturnType<typeof useChat> | undefined;
  function Conversation() {
    const chat = useChat();
    api = chat;
    const [editing, setEditing] = useState<string | null>(null);
    return createElement('div', null, chat.messages.map((m) => createElement(ChatMessage, {
      key: m.id, message: m, timezone: 'UTC', busy: chat.sending, onRetry: chat.retry,
      editing: editing === m.id, savedActions: false, onEdit: setEditing,
      onCancelEdit: () => setEditing(null), onSaveEdit: chat.edit,
    })));
  }
  // eslint-disable-next-line react/no-children-prop
  render(createElement(MemoryRouter, { children: createElement(TrackerProvider, { service, children: createElement(ChatProvider, { service, onRecordsChanged: async () => {}, children: createElement(Conversation) }) }) }));
  act(() => api!.openSession(initial.sessionId));
  await screen.findByText('Hello');
  fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
  fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), { target: { value: 'How much did I spend today?' } });
  fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
  await waitFor(() => expect(api!.activeSessionId).not.toBe(initial.sessionId), { timeout: 5000 });
  expect(screen.getByText('How much did I spend today?')).toBeTruthy();
  expect(screen.queryByText('Hello')).toBeNull();
  expect(screen.getByText(/did not change or create any records/)).toBeTruthy();
  expect((await service.getChatHistory(initial.sessionId))[0]?.content).toBe('Hello');
});
