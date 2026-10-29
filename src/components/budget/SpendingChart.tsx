"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { PiggyBank } from "lucide-react";
import { EmptyState } from "@/components/ui/Feedback";
import { formatCurrency } from "@/lib/formatting";

const COLORS = [
  "#3478e8",
  "#16a362",
  "#d98c0a",
  "#e5484d",
  "#8a5cf6",
  "#0ea5c4",
  "#f97066",
  "#64748b",
];

export function SpendingChart({ data }: { data: { category: string; amount: number }[] }) {
  const filtered = data.filter((d) => d.amount > 0).sort((a, b) => b.amount - a.amount);

  if (filtered.length === 0) {
    return (
      <EmptyState icon={<PiggyBank size={20} />} title="No spending yet" description="Add an expense to see your category breakdown." />
    );
  }

  const total = filtered.reduce((a, b) => a + b.amount, 0);

  return (
    <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
      <div className="h-44 w-full shrink-0 sm:h-44 sm:w-44">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie
              data={filtered}
              dataKey="amount"
              nameKey="category"
              innerRadius="58%"
              outerRadius="100%"
              paddingAngle={2}
              strokeWidth={0}
            >
              {filtered.map((entry, index) => (
                <Cell key={entry.category} fill={COLORS[index % COLORS.length]} />
              ))}
            </Pie>
            <Tooltip
              contentStyle={{
                background: "var(--surface-raised)",
                border: "1px solid var(--border-subtle)",
                borderRadius: 10,
                fontSize: 12,
              }}
              formatter={(value, name) => [formatCurrency(typeof value === "number" ? value : Number(value ?? 0)), String(name)]}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <ul className="flex min-w-0 flex-1 flex-col gap-2">
        {filtered.map((entry, index) => (
          <li key={entry.category} className="flex items-center justify-between gap-2 text-sm">
            <span className="flex min-w-0 items-center gap-2">
              <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: COLORS[index % COLORS.length] }} />
              <span className="truncate text-[var(--text-secondary)]">{entry.category}</span>
            </span>
            <span className="shrink-0 font-medium text-[var(--text-primary)]">
              {formatCurrency(entry.amount)}
              <span className="ml-1.5 text-xs font-normal text-[var(--text-tertiary)]">
                ({Math.round((entry.amount / total) * 100)}%)
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
