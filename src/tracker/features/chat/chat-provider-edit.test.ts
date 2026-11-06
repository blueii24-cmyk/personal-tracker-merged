// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { act, cleanup, render, waitFor } from '@testing-library/react';
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
  expect(api!.messages.some((m) => m.id === initial.userMessageId)).toBe(true);
  expect(api!.messages.at(-1)?.content).toContain('did not change or create any records');
  expect((await service.getTransactions()).map((t) => t.amount)).toEqual([50]);
});
