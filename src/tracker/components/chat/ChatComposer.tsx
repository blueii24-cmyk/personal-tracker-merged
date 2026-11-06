import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ArrowUp, Square } from 'lucide-react';
import { cn } from '@/tracker/lib/cn';

export interface ChatComposerHandle {
  /** Replace the draft and focus; `caretFromEnd` places the cursor that many characters before the end. */
  fill: (text: string, caretFromEnd?: number) => void;
  focus: () => void;
}

interface Props {
  sending: boolean;
  onSend: (text: string) => void;
  onStop: () => void;
  /** Reserved for a future voice-input control. Nothing is rendered until one exists. */
  leadingSlot?: ReactNode;
  autoFocus?: boolean;
}

const MAX = 4000;

export const ChatComposer = forwardRef<ChatComposerHandle, Props>(function ChatComposer({ sending, onSend, onStop, leadingSlot, autoFocus }, ref) {
  const [value, setValue] = useState('');
  const el = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const t = el.current;
    if (!t) return;
    t.style.height = 'auto';
    // CSS also caps the height relative to the resized viewport in landscape/with the IME open.
    t.style.height = `${Math.min(t.scrollHeight, 200)}px`;
  }, []);
  useEffect(resize, [value, resize]);

  useImperativeHandle(ref, () => ({
    fill: (text, caretFromEnd = 0) => {
      setValue(text);
      requestAnimationFrame(() => {
        const t = el.current;
        if (!t) return;
        t.focus();
        const pos = Math.max(0, text.length - caretFromEnd);
        t.setSelectionRange(pos, pos);
      });
    },
    focus: () => el.current?.focus(),
  }));

  const submit = () => {
    const text = value.trim();
    if (!text || sending) return;
    onSend(text);
    setValue('');
  };
  const onKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      submit();
    }
  };

  const canSend = value.trim().length > 0 && !sending;
  return (
    <div>
      <div className="flex items-end gap-2 rounded-[28px] bg-surface p-2 pl-3 ring-1 ring-line shadow-sm transition-colors focus-within:ring-2 focus-within:ring-primary">
        {leadingSlot}
        <label htmlFor="chat-input" className="sr-only">
          Message the assistant
        </label>
        <textarea
          id="chat-input"
          ref={el}
          value={value}
          onChange={(e) => setValue(e.target.value.slice(0, MAX))}
          onKeyDown={onKeyDown}
          rows={1}
          autoFocus={autoFocus}
          enterKeyHint="send"
          placeholder="Tell me what you ate, spent or weigh, or ask a question…"
          className="max-h-[min(200px,25dvh)] min-h-10 min-w-0 flex-1 resize-none overflow-y-auto bg-transparent px-2.5 py-2 leading-6 text-ink outline-none placeholder:text-ink-3"
        />
        {sending ? (
          <button type="button" onClick={onStop} aria-label="Stop generating" className="grid size-10 shrink-0 place-items-center rounded-full bg-primary text-on-primary transition-opacity hover:opacity-90">
            <Square className="size-3.5 fill-current" aria-hidden />
          </button>
        ) : (
          <button
            type="button"
            onClick={submit}
            disabled={!canSend}
            aria-label="Send message"
            className={cn('grid size-10 shrink-0 place-items-center rounded-full bg-primary text-on-primary transition-[opacity,transform] duration-300 ease-[var(--ease-spring)] active:scale-90', canSend ? 'scale-100 hover:opacity-90' : 'scale-90 opacity-30')}
          >
            <ArrowUp className="size-[18px]" aria-hidden />
          </button>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between gap-3 px-1 text-[11px] text-ink-3">
        <span className="hidden sm:inline">Enter to send · Shift+Enter for a new line</span>
        {value.length > MAX - 500 && <span className="tnum ml-auto">{value.length}/{MAX}</span>}
      </div>
    </div>
  );
});
