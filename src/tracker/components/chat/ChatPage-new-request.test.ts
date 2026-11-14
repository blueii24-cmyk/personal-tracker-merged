// @vitest-environment jsdom
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import ChatPage from './ChatPage';

const state = vi.hoisted(() => ({
  send: vi.fn(),
  mode: 'log',
  sending: false,
  activeSessionId: 'session',
  messages: [
    { id: 'edited', sessionId: 'session', role: 'user', status: 'complete', content: 'I ate khichdi for lunch', editOfMessageId: 'original', createdAt: '2026-10-30T12:00:00Z' },
    { id: 'reply', sessionId: 'session', role: 'assistant', status: 'complete', content: 'This correction did not change or create any records.', createdAt: '2026-10-30T12:00:00Z' },
  ],
}));
vi.mock('@/tracker/features/chat/ChatProvider', () => ({ useChat: () => ({ ...state, sessions: [], loadingHistory: false, historyError: null, changeMode: vi.fn(), retry: vi.fn(), edit: vi.fn(), stop: vi.fn(), newChat: vi.fn(), openSession: vi.fn(), deleteSession: vi.fn() }) }));
vi.mock('@/tracker/features/store/TrackerProvider', () => ({ useTracker: () => ({ timezone: 'UTC', today: '2026-10-30', service: { mode: 'connected' }, settings: {}, meals: [], transactions: [], weighIns: [] }) }));
vi.mock('@/tracker/features/ai-config/AiConfigProvider', () => ({ useAiConfig: () => ({ active: true, config: { model: 'test' } }) }));
vi.mock('@/tracker/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
beforeEach(() => {
  state.mode = 'log'; state.sending = false; state.activeSessionId = 'session';
  Object.defineProperty(HTMLElement.prototype, 'scrollTo', { configurable: true, value: vi.fn() });
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value(this: HTMLDialogElement) { this.setAttribute('open', ''); } });
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value(this: HTMLDialogElement) { this.removeAttribute('open'); } });
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

it('requires confirmation to send an edited message as a new request and keeps an existing composer draft', () => {
  render(createElement(MemoryRouter, null, createElement(ChatPage)));
  fireEvent.change(screen.getByLabelText('Message the assistant'), { target: { value: 'my unsent draft' } });
  fireEvent.click(screen.getByRole('button', { name: 'Send as new request' }));
  expect(state.send).not.toHaveBeenCalled();
  let dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText(/check your existing records first to avoid duplicates/)).toBeTruthy();
  expect(within(dialog).getByText('I ate khichdi for lunch')).toBeTruthy();
  fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
  expect(state.send).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: 'Send as new request' }));
  dialog = screen.getByRole('dialog');
  fireEvent.click(within(dialog).getByRole('button', { name: 'Send new request' }));
  expect(state.send).toHaveBeenCalledTimes(1);
  expect(state.send).toHaveBeenCalledWith('I ate khichdi for lunch');
  expect((screen.getByLabelText('Message the assistant') as HTMLTextAreaElement).value).toBe('my unsent draft');
});

it('does not offer a new write request in Casual Mode', () => {
  state.mode = 'casual';
  render(createElement(MemoryRouter, null, createElement(ChatPage)));
  expect(screen.queryByRole('button', { name: 'Send as new request' })).toBeNull();
});

it('does not send a confirmation into a different conversation', () => {
  const view = render(createElement(MemoryRouter, null, createElement(ChatPage)));
  fireEvent.click(screen.getByRole('button', { name: 'Send as new request' }));
  state.activeSessionId = 'another-session';
  view.rerender(createElement(MemoryRouter, null, createElement(ChatPage)));
  fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Send new request' }));
  expect(state.send).not.toHaveBeenCalled();
});
