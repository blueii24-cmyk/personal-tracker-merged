"use client";

import { Search } from "lucide-react";
import { Input, Select } from "@/components/ui/FormControls";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/api/tracker-service";
import type { EntryTypeFilter } from "./HistoryList";

export interface HistoryFilterState {
  search: string;
  entryType: EntryTypeFilter;
  category: string;
  from: string;
  to: string;
}

export function HistoryFilters({
  value,
  onChange,
}: {
  value: HistoryFilterState;
  onChange: (next: HistoryFilterState) => void;
}) {
  const categories = Array.from(new Set([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES]));

  return (
    <div className="flex flex-col gap-3">
      <div className="relative">
        <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-tertiary)]" />
        <Input
          value={value.search}
          onChange={(e) => onChange({ ...value, search: e.target.value })}
          placeholder="Search records\u2026"
          className="pl-9"
          aria-label="Search history"
        />
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select
          value={value.entryType}
          onChange={(e) => onChange({ ...value, entryType: e.target.value as EntryTypeFilter })}
          aria-label="Filter by entry type"
        >
          <option value="all">All types</option>
          <option value="meal">Meals</option>
          <option value="expense">Expenses</option>
          <option value="income">Income</option>
          <option value="weight">Weigh-ins</option>
        </Select>
        <Select
          value={value.category}
          onChange={(e) => onChange({ ...value, category: e.target.value })}
          aria-label="Filter by category"
        >
          <option value="all">All categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
        <Input
          type="date"
          value={value.from}
          onChange={(e) => onChange({ ...value, from: e.target.value })}
          aria-label="From date"
        />
        <Input type="date" value={value.to} onChange={(e) => onChange({ ...value, to: e.target.value })} aria-label="To date" />
      </div>
    </div>
  );
}
