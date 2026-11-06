import { TrackerError } from '@/tracker/lib/api/errors';
import type { ChatMessage } from '@/tracker/types/domain';

/** Edits are appended as new turns, never replacements: earlier receipts and later turns remain intact. */
export function editContext(history: ChatMessage[], editOfMessageId: string): { original: ChatMessage; savedActions: boolean } {
  const index = history.findIndex((m) => m.id === editOfMessageId && m.role === 'user' && m.status === 'complete');
  if (index < 0) throw new TrackerError('INVALID_REQUEST', 'The original message could not be found in this conversation.', { retryable: false });
  const nextUser = history.findIndex((m, i) => i > index && m.role === 'user');
  const replies = history.slice(index + 1, nextUser < 0 ? undefined : nextUser);
  return {
    original: history[index]!,
    savedActions: replies.some((m) => m.role === 'assistant' && m.actions?.some((a) => a.status === 'succeeded' && a.recordIds?.length)),
  };
}

export const EDIT_NOTICE = 'This correction did not change or create any records. Review existing records before making a separate change.';
