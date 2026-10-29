"use client";

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WeighIn } from "@/types/domain";
import { formatDateShort, formatWeight } from "@/lib/formatting";
import { EmptyState } from "@/components/ui/Feedback";
import { Scale } from "lucide-react";

export function WeightChart({ weighIns, unit = "kg" }: { weighIns: WeighIn[]; unit?: "kg" | "lb" }) {
  if (weighIns.length === 0) {
    return (
      <EmptyState
        icon={<Scale size={20} />}
        title="No weigh-ins yet"
        description="Log your weight to start seeing your progress trend here."
      />
    );
  }

  const data = weighIns.map((w) => ({
    date: w.date,
    label: formatDateShort(w.date),
    weight: unit === "lb" ? Number((w.weightKg * 2.20462).toFixed(1)) : w.weightKg,
  }));

  const values = data.map((d) => d.weight);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = Math.max(0.5, (max - min) * 0.25);

  return (
    <div className="h-56 w-full sm:h-64">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
          <defs>
            <linearGradient id="weightFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--color-brand-500)" stopOpacity={0.28} />
              <stop offset="100%" stopColor="var(--color-brand-500)" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border-subtle)" vertical={false} />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
            tickLine={false}
            axisLine={{ stroke: "var(--border-subtle)" }}
            minTickGap={24}
          />
          <YAxis
            domain={[min - pad, max + pad]}
            tick={{ fontSize: 11, fill: "var(--text-tertiary)" }}
            tickLine={false}
            axisLine={false}
            width={40}
          />
          <Tooltip
            contentStyle={{
              background: "var(--surface-raised)",
              border: "1px solid var(--border-subtle)",
              borderRadius: 10,
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--text-secondary)" }}
            formatter={(value) => {
              const numeric = typeof value === "number" ? value : Number(value ?? 0);
              return [formatWeight(unit === "lb" ? numeric / 2.20462 : numeric, unit), "Weight"];
            }}
          />
          <Area type="monotone" dataKey="weight" stroke="var(--color-brand-500)" strokeWidth={2} fill="url(#weightFill)" />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
