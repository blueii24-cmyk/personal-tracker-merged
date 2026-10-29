import { RotateCcw, Sparkles, TriangleAlert } from "lucide-react";
import type { ChatMessage as ChatMessageType } from "@/types/domain";
import { ActionConfirmationCard } from "./ActionConfirmationCard";
import { formatTime } from "@/lib/formatting";

export function ChatMessage({ message, onRetry }: { message: ChatMessageType; onRetry?: () => void }) {
  const isUser = message.role === "user";

  if (isUser) {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] sm:max-w-[70%]">
          <div className="rounded-2xl rounded-br-sm bg-brand-600 px-4 py-2.5 text-sm text-white shadow-soft">
            {message.content}
          </div>
          <p className="mt-1 text-right text-[11px] text-[var(--text-tertiary)]">{formatTime(message.createdAt)}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
        <Sparkles size={13} />
      </div>
      <div className="min-w-0 max-w-[85%] sm:max-w-[70%]">
        {message.status === "error" ? (
          <div className="flex items-start gap-2 rounded-2xl rounded-tl-sm border border-danger-500/30 bg-danger-50 px-4 py-2.5 text-sm text-danger-600 dark:bg-danger-500/5">
            <TriangleAlert size={15} className="mt-0.5 shrink-0" />
            <div>
              <p>{message.content}</p>
              {onRetry && (
                <button
                  type="button"
                  onClick={onRetry}
                  className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-danger-600 hover:underline"
                >
                  <RotateCcw size={12} /> Retry
                </button>
              )}
            </div>
          </div>
        ) : (
          <div className="rounded-2xl rounded-tl-sm bg-[var(--surface-sunken)] px-4 py-2.5 text-sm leading-relaxed text-[var(--text-primary)]">
            {message.content}
          </div>
        )}
        {message.action && <ActionConfirmationCard action={message.action} />}
        <p className="mt-1 text-[11px] text-[var(--text-tertiary)]">{formatTime(message.createdAt)}</p>
      </div>
    </div>
  );
}

export function TypingIndicator() {
  return (
    <div className="flex items-start gap-2.5">
      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-600 text-white">
        <Sparkles size={13} />
      </div>
      <div className="flex items-center gap-1 rounded-2xl rounded-tl-sm bg-[var(--surface-sunken)] px-4 py-3">
        {[0, 1, 2].map((i) => (
          <span
            key={i}
            className="h-1.5 w-1.5 animate-bounce rounded-full bg-[var(--text-tertiary)]"
            style={{ animationDelay: `${i * 120}ms` }}
          />
        ))}
      </div>
    </div>
  );
}
