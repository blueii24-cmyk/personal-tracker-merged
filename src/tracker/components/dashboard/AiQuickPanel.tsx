import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowUp, Sparkles } from 'lucide-react';
import { cn } from '@/tracker/lib/cn';

const EXAMPLES = ['I ate three eggs and a glass of milk', 'I spent ₹60 on bus fare', 'My weight is 48.2 kg today', 'How much money is left this month?'];

/** Compact entry point: type a sentence here and the chat page sends it. */
export function AiQuickPanel({ className }: { className?: string }) {
  const [value, setValue] = useState('');
  const navigate = useNavigate();

  const go = (prompt: string) => {
    const text = prompt.trim();
    if (!text) return;
    navigate('/chat', { state: { prompt: text } });
  };
  const submit = (e: FormEvent) => {
    e.preventDefault();
    go(value);
  };

  return (
    <section aria-label="Ask the assistant" className={cn('rounded-xl bg-surface p-4 sm:p-5', className)}>
      <form onSubmit={submit} className="flex items-center gap-2 rounded-full bg-sunken py-1.5 pr-1.5 pl-4 focus-within:bg-surface focus-within:ring-2 focus-within:ring-primary">
        <Sparkles className="size-[18px] shrink-0 text-ink-3" aria-hidden />
        <label htmlFor="quick-ai" className="sr-only">
          Tell the assistant what to log
        </label>
        <input
          id="quick-ai"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder="Tell me what you ate, spent or weigh…"
          maxLength={500}
          className="h-9 min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-ink-3"
        />
        <button type="submit" disabled={!value.trim()} aria-label="Send to assistant" className="grid size-9 shrink-0 place-items-center rounded-full bg-primary text-on-primary transition-opacity disabled:opacity-30">
          <ArrowUp className="size-[18px]" aria-hidden />
        </button>
      </form>
      <div className="mt-2.5 flex gap-2 overflow-x-auto pb-0.5 [scrollbar-width:none]">
        {EXAMPLES.map((ex) => (
          <button key={ex} type="button" onClick={() => go(ex)} className="shrink-0 rounded-full border border-line-strong px-3.5 py-1.5 text-xs text-ink-2 transition-colors hover:bg-primary-container/60 hover:text-on-primary-container">
            {ex}
          </button>
        ))}
      </div>
    </section>
  );
}
