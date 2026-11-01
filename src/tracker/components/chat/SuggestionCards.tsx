import { ClipboardList, PencilLine, ReceiptIndianRupee, Scale, Utensils, type LucideIcon } from 'lucide-react';

export interface Suggestion {
  id: string;
  title: string;
  example: string;
  icon: LucideIcon;
  /** `fill` puts a starter in the message box for you to finish; `send` runs it straight away. */
  mode: 'fill' | 'send';
  text: string;
  caretFromEnd?: number;
}

export const SUGGESTIONS: Suggestion[] = [
  { id: 'meal', title: 'Log a meal', example: '“I ate three eggs and a glass of milk”', icon: Utensils, mode: 'fill', text: 'I ate ', caretFromEnd: 0 },
  { id: 'expense', title: 'Record an expense', example: '“I spent ₹60 travelling to college”', icon: ReceiptIndianRupee, mode: 'fill', text: 'I spent ₹ on ', caretFromEnd: 4 },
  { id: 'weight', title: 'Update my weight', example: '“My weight is 48.2 kg today”', icon: Scale, mode: 'fill', text: 'My weight is  kg today', caretFromEnd: 10 },
  { id: 'day', title: 'Summarise my day', example: 'Meals, spending and weight so far', icon: ClipboardList, mode: 'send', text: 'Summarise my day' },
  { id: 'spending', title: 'Review my spending', example: 'Where this month’s money went', icon: PencilLine, mode: 'send', text: 'Review my spending this month' },
];

export function SuggestionCards({ onPick }: { onPick: (s: Suggestion) => void }) {
  return (
    <ul className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
      {SUGGESTIONS.map((s) => (
        <li key={s.id} className={s.id === 'spending' ? 'sm:col-span-2' : undefined}>
          <button
            type="button"
            onClick={() => onPick(s)}
            className="group flex h-full w-full items-start gap-3 rounded-[24px] bg-surface p-4 text-left transition-colors hover:bg-primary-container/50"
          >
            <span className="icon-wiggle grid size-9 shrink-0 place-items-center rounded-full bg-primary-container text-on-primary-container">
              <s.icon className="size-[18px]" aria-hidden />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-ink">{s.title}</span>
              <span className="mt-0.5 block text-[13px] text-ink-3">{s.example}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}
