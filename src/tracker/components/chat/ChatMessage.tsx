import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, Pencil, RotateCw } from 'lucide-react';
import { Button } from '@/tracker/components/ui/Button';
import { LogoMark } from '@/tracker/components/layout/Brand';
import { formatTime } from '@/tracker/lib/formatting/dates';
import { cn } from '@/tracker/lib/cn';
import type { ChatMessage as Msg } from '@/tracker/types/domain';
import { ActionConfirmationCard } from './ActionConfirmationCard';
import { RichText } from './RichText';

interface Props {
  message: Msg;
  timezone: string;
  busy: boolean;
  onRetry: (id: string) => void;
  editing: boolean;
  savedActions: boolean;
  onEdit: (id: string) => void;
  onCancelEdit: () => void;
  onSaveEdit: (id: string, text: string) => boolean;
}

export function ChatMessage({ message, timezone, busy, onRetry, editing, savedActions, onEdit, onCancelEdit, onSaveEdit }: Props) {
  const [draft, setDraft] = useState(message.content);
  const time = <time dateTime={message.createdAt} className="msg-time text-[11px] text-ink-3">{formatTime(message.createdAt, timezone)}</time>;

  if (message.role === 'user') {
    return (
      <div className="group flex flex-col items-end gap-1">
        {message.editOfMessageId && <span className="text-xs text-ink-3">Edited message</span>}
        {editing ? (
          <form className="w-full max-w-[88%] rounded-[22px] bg-primary-container p-3 text-on-primary-container sm:max-w-[75%]" onSubmit={(e) => { e.preventDefault(); if (onSaveEdit(message.id, draft)) onCancelEdit(); }}>
            <label htmlFor={`edit-${message.id}`} className="sr-only">Edit message</label>
            <textarea id={`edit-${message.id}`} value={draft} onChange={(e) => setDraft(e.target.value.slice(0, 4000))} rows={3} className="w-full resize-y rounded-xl bg-surface p-2 text-[15px] text-ink outline-primary" />
            <p className="mt-1 text-xs">{savedActions ? 'This message already saved records. ' : ''}Saving creates a revised conversation from this point; the original and later messages remain under Conversations. Regeneration will not change or undo records. Correct a record separately.</p>
            <div className="mt-2 flex justify-end gap-2">
              <Button size="sm" variant="ghost" onClick={onCancelEdit}>Cancel</Button>
              <Button size="sm" variant="secondary" type="submit" disabled={busy || !draft.trim() || draft.trim() === message.content}>Save edit</Button>
            </div>
          </form>
        ) : (
          <div className={cn('max-w-[88%] rounded-[22px] rounded-br-md bg-primary-container px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap break-words text-on-primary-container sm:max-w-[75%]', message.status === 'sending' && 'opacity-70')}>
            {message.content}
          </div>
        )}
        {message.status === 'error' && message.error ? (
          <div role="alert" className="flex max-w-[88%] flex-wrap items-center justify-end gap-x-2 gap-y-1 text-[13px] text-danger sm:max-w-[75%]">
            <AlertCircle className="size-3.5 shrink-0" aria-hidden />
            <span>{message.error.message}</span>
            {message.error.code.startsWith('AI_KEY') || message.error.code === 'AI_MODEL_NOT_FOUND' ? (
              <Link to="/settings#ai" className="font-medium underline underline-offset-2">
                Open AI settings
              </Link>
            ) : null}
            {message.error.retryable && (
              <Button size="sm" variant="secondary" onClick={() => onRetry(message.id)} disabled={busy}>
                <RotateCw className="size-3.5" aria-hidden />
                Retry
              </Button>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-2">
            {time}
            {message.status === 'complete' && !editing && <button type="button" disabled={busy} onClick={() => { setDraft(message.content); onEdit(message.id); }} className="inline-flex min-h-11 items-center gap-1.5 px-2 text-[13px] font-medium text-primary underline underline-offset-2 disabled:opacity-50" aria-label="Edit message"><Pencil className="size-3" aria-hidden />Edit</button>}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="group flex gap-3">
      <LogoMark className="mt-0.5 size-7 rounded-full" />
      <div className="min-w-0 flex-1">
        <div className={cn('text-[15px] leading-relaxed text-ink', message.status === 'streaming' && 'caret')}>
          <RichText text={message.content} />
        </div>
        {message.preservedActions && message.preservedActions.length > 0 && (
          <section aria-label="Saved by the original message">
            <p className="mt-3 text-xs text-ink-2">Saved by the original message — unchanged</p>
            {message.preservedActions.map((a, i) => <ActionConfirmationCard key={`${a.toolCallId}-${i}`} action={a} />)}
          </section>
        )}
        {message.actions?.map((a) => (
          <ActionConfirmationCard key={a.toolCallId} action={a} />
        ))}
        <div className="mt-1.5">{time}</div>
      </div>
    </div>
  );
}

export function ThinkingIndicator() {
  return (
    <div className="flex gap-3" role="status" aria-label="Assistant is working on your message">
      <LogoMark className="mt-0.5 size-7 rounded-full" />
      <div className="flex h-7 items-center gap-1.5 text-ink-3">
        <span className="thinking-dot size-2 rounded-full bg-[#4285f4]" />
        <span className="thinking-dot size-2 rounded-full bg-[#ea4335]" />
        <span className="thinking-dot size-2 rounded-full bg-[#fbbc04]" />
        <span className="thinking-dot size-2 rounded-full bg-[#34a853]" />
        <span className="ml-1.5 text-[13px]">Working on it…</span>
      </div>
    </div>
  );
}
