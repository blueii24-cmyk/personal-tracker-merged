import { Link } from 'react-router-dom';
import { AlertCircle, RotateCw } from 'lucide-react';
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
}

export function ChatMessage({ message, timezone, busy, onRetry }: Props) {
  const time = <time dateTime={message.createdAt} className="msg-time text-[11px] text-ink-3">{formatTime(message.createdAt, timezone)}</time>;

  if (message.role === 'user') {
    return (
      <div className="group flex flex-col items-end gap-1">
        <div className={cn('max-w-[88%] rounded-[22px] rounded-br-md bg-primary-container px-4 py-2.5 text-[15px] leading-relaxed whitespace-pre-wrap text-on-primary-container sm:max-w-[75%]', message.status === 'sending' && 'opacity-70')}>
          {message.content}
        </div>
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
          time
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
