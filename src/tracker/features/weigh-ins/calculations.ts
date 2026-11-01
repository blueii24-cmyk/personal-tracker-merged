import { dateKeyInTz } from '@/tracker/lib/formatting/dates';
import type { DateKey, WeighIn, WeightSummary } from '@/tracker/types/domain';

export function sortWeighIns(list: readonly WeighIn[]): WeighIn[] {
  return [...list].sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
}

export function weightSummary(list: readonly WeighIn[]): WeightSummary {
  const sorted = sortWeighIns(list);
  const latest = sorted.at(-1) ?? null;
  const previous = sorted.length > 1 ? (sorted.at(-2) ?? null) : null;
  const changeKg = latest && previous ? Math.round((latest.weightKg - previous.weightKg) * 100) / 100 : null;
  return { latest, previous, changeKg, count: sorted.length };
}

export function weighInsInRange(list: readonly WeighIn[], from: DateKey | undefined, to: DateKey | undefined, tz: string): WeighIn[] {
  return sortWeighIns(list).filter((w) => {
    const k = dateKeyInTz(w.recordedAt, tz);
    return (!from || k >= from) && (!to || k <= to);
  });
}

/** Net change across a window, or null with fewer than two readings (no trend from a single point). */
export function changeAcross(list: readonly WeighIn[]): number | null {
  if (list.length < 2) return null;
  const sorted = sortWeighIns(list);
  return Math.round((sorted[sorted.length - 1]!.weightKg - sorted[0]!.weightKg) * 100) / 100;
}
