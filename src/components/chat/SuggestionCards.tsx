import { Banknote, LineChart, Salad, Scale, Wallet } from "lucide-react";
import type { ComponentType } from "react";

export interface Suggestion {
  icon: ComponentType<{ size?: number; className?: string }>;
  title: string;
  prompt: string;
}

export const SUGGESTIONS: Suggestion[] = [
  { icon: Salad, title: "Log a meal", prompt: "I ate 3 eggs, 2 bananas and drank a glass of milk." },
  { icon: Wallet, title: "Record an expense", prompt: "I spent \u20b960 travelling to college." },
  { icon: Banknote, title: "Record income", prompt: "I received \u20b92000 pocket money." },
  { icon: Scale, title: "Update my weight", prompt: "My weight is 48.2 kg today." },
  { icon: LineChart, title: "Summarise my day", prompt: "Summarise my day." },
];

export function SuggestionCards({ onSelect }: { onSelect: (prompt: string) => void }) {
  return (
    <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {SUGGESTIONS.map((s) => (
        <button
          key={s.title}
          type="button"
          onClick={() => onSelect(s.prompt)}
          className="flex items-start gap-3 rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] p-3.5 text-left shadow-soft transition-colors hover:border-brand-300 hover:bg-brand-50/40 dark:hover:bg-brand-500/5"
        >
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-brand-50 text-brand-600 dark:bg-brand-500/10 dark:text-brand-400">
            <s.icon size={16} />
          </div>
          <div className="min-w-0">
            <p className="text-sm font-medium text-[var(--text-primary)]">{s.title}</p>
            <p className="mt-0.5 truncate text-xs text-[var(--text-secondary)]">{s.prompt}</p>
          </div>
        </button>
      ))}
    </div>
  );
}
