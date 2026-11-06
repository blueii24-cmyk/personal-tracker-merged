import { TrackerError } from '@/tracker/lib/api/errors';
import type { ChatMessage } from '@/tracker/types/domain';

import type { AiActionResult } from '@/tracker/types/api';

/** The old session is immutable; a revised branch begins at the edited turn. */
export function editContext(history: ChatMessage[], editOfMessageId: string): { original: ChatMessage; prefix: ChatMessage[]; savedActions: boolean; receipts: AiActionResult[] } {
  const index = history.findIndex((m) => m.id === editOfMessageId && m.role === 'user' && m.status === 'complete');
  if (index < 0) throw new TrackerError('INVALID_REQUEST', 'The original message could not be found in this conversation.', { retryable: false });
  const nextUser = history.findIndex((m, i) => i > index && m.role === 'user');
  const replies = history.slice(index + 1, nextUser < 0 ? undefined : nextUser);
  const receipts = replies.flatMap((m) => m.role === 'assistant' ? [...(m.preservedActions ?? []), ...(m.actions ?? [])] : [])
    .filter((a) => a.status === 'succeeded' && a.recordIds?.length);
  return { original: history[index]!, prefix: history.slice(0, index), savedActions: receipts.length > 0, receipts };
}

export const EDIT_NOTICE = 'This correction did not change or create any records. Review existing records before making a separate change.';
