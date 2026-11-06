// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createElement, useState } from 'react';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { ChatMessage as Message } from '@/tracker/types/domain';
import { ChatMessage } from './ChatMessage';

const message: Message = { id: 'u1', role: 'user', sessionId: 's', content: 'original', status: 'complete', createdAt: '2026-10-30T00:00:00Z' };
const save = vi.fn(() => true);
function Harness({ msg = message }: { msg?: Message }) {
  const [editing, setEditing] = useState(false);
  return createElement(MemoryRouter, null, createElement(ChatMessage, {
    message: msg, timezone: 'UTC', busy: false, onRetry: vi.fn(), editing, savedActions: true,
    onEdit: () => setEditing(true), onCancelEdit: () => setEditing(false), onSaveEdit: save,
  }));
}
afterEach(() => { cleanup(); save.mockClear(); });

describe('message edit controls', () => {
  it('allows editing and cancel without submitting', () => {
    render(createElement(Harness, {}));
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), { target: { value: 'corrected' } });
    expect(screen.getByText(/already saved records/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect(screen.getByText('original')).toBeTruthy();
    expect(save).not.toHaveBeenCalled();
  });
  it('submits the corrected text', () => {
    render(createElement(Harness, {}));
    fireEvent.click(screen.getByRole('button', { name: 'Edit message' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Edit message' }), { target: { value: 'corrected' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save edit' }));
    expect(save).toHaveBeenCalledOnce();
    expect(save).toHaveBeenCalledWith('u1', 'corrected');
  });
  it('does not offer editing on assistant messages', () => {
    render(createElement(Harness, { msg: { ...message, role: 'assistant' } }));
    expect(screen.queryByRole('button', { name: 'Edit message' })).toBeNull();
  });
});
