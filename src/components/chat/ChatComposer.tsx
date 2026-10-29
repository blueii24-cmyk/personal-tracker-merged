"use client";

import { Mic, Send, Square } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export function ChatComposer({
  onSend,
  onStop,
  sending,
}: {
  onSend: (content: string) => void;
  onStop: () => void;
  sending: boolean;
}) {
  const [value, setValue] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 160)}px`;
  }, [value]);

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || sending) return;
    onSend(trimmed);
    setValue("");
  };

  return (
    <div className="border-t border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3 sm:p-4">
      <div className="mx-auto flex max-w-3xl items-end gap-2 rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] p-2 shadow-soft focus-within:border-brand-400 focus-within:ring-2 focus-within:ring-brand-500/20">
        <button
          type="button"
          disabled
          aria-label="Voice input (coming soon)"
          title="Voice input is coming soon"
          className="flex h-9 w-9 shrink-0 cursor-not-allowed items-center justify-center rounded-xl text-[var(--text-tertiary)] opacity-50"
        >
          <Mic size={18} />
        </button>
        <textarea
          ref={textareaRef}
          rows={1}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Message your tracker assistant\u2026"
          aria-label="Chat message"
          className="max-h-40 flex-1 resize-none bg-transparent px-1 py-1.5 text-sm text-[var(--text-primary)] placeholder:text-[var(--text-tertiary)] focus:outline-none"
        />
        {sending ? (
          <button
            type="button"
            onClick={onStop}
            aria-label="Stop generating"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-[var(--surface-sunken)] text-[var(--text-primary)] hover:bg-[var(--border-subtle)]"
          >
            <Square size={14} />
          </button>
        ) : (
          <button
            type="button"
            onClick={handleSend}
            disabled={!value.trim()}
            aria-label="Send message"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-brand-600 text-white transition-colors hover:bg-brand-700 disabled:cursor-not-allowed disabled:bg-brand-300"
          >
            <Send size={15} />
          </button>
        )}
      </div>
      <p className="mx-auto mt-2 max-w-3xl text-center text-[11px] text-[var(--text-tertiary)]">
        Press Enter to send, Shift + Enter for a new line. Demo mode \u2014 replies are generated locally, not by a live AI model.
      </p>
    </div>
  );
}
