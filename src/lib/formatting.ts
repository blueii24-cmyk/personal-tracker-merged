// Shared, pure formatting helpers used across the UI. Keeping these outside
// components avoids duplicated business/formatting logic.

const inrFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const inrFormatterPrecise = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 2,
});

export function formatCurrency(amount: number, precise = false): string {
  const formatter = precise ? inrFormatterPrecise : inrFormatter;
  return formatter.format(Number.isFinite(amount) ? amount : 0);
}

export function formatSignedCurrency(amount: number): string {
  const sign = amount > 0 ? "+" : amount < 0 ? "\u2212" : "";
  return `${sign}${formatCurrency(Math.abs(amount))}`;
}

export function formatNumberIN(value: number): string {
  return new Intl.NumberFormat("en-IN").format(value);
}

export function formatDateLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-IN", {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

export function formatDateShort(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleDateString("en-IN", { day: "numeric", month: "short" });
}

export function formatTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit" });
}

export function formatDateTime(iso: string): string {
  return `${formatDateLabel(iso)} \u00b7 ${formatTime(iso)}`;
}

export function toISODate(date: Date): string {
  const offset = date.getTimezoneOffset();
  const local = new Date(date.getTime() - offset * 60 * 1000);
  return local.toISOString().slice(0, 10);
}

export function todayISODate(): string {
  return toISODate(new Date());
}

export function isSameDay(isoA: string, isoB: string): boolean {
  return toISODate(new Date(isoA)) === toISODate(new Date(isoB));
}

export function isToday(iso: string): boolean {
  return isSameDay(iso, new Date().toISOString());
}

export function isYesterday(iso: string): boolean {
  const yesterday = new Date();
  yesterday.setDate(yesterday.getDate() - 1);
  return isSameDay(iso, yesterday.toISOString());
}

export function relativeDayLabel(iso: string): string {
  if (isToday(iso)) return "Today";
  if (isYesterday(iso)) return "Yesterday";
  return formatDateLabel(iso);
}

export function formatRelativeTime(iso: string): string {
  const date = new Date(iso);
  const diffMs = Date.now() - date.getTime();
  const diffMin = Math.round(diffMs / 60000);
  if (diffMin < 1) return "Just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.round(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDay = Math.round(diffHr / 24);
  if (diffDay === 1) return "Yesterday";
  if (diffDay < 7) return `${diffDay}d ago`;
  return formatDateLabel(iso);
}

export function monthLabel(year: number, month: number): string {
  return new Date(year, month, 1).toLocaleDateString("en-IN", {
    month: "long",
    year: "numeric",
  });
}

export function startOfMonthISO(year: number, month: number): string {
  return toISODate(new Date(year, month, 1));
}

export function endOfMonthISO(year: number, month: number): string {
  return toISODate(new Date(year, month + 1, 0));
}

export function formatGrams(value: number): string {
  return `${Math.round(value)} g`;
}

export function formatKcal(value: number): string {
  return `${formatNumberIN(Math.round(value))} kcal`;
}

export function formatWeight(valueKg: number, unit: "kg" | "lb" = "kg"): string {
  if (unit === "lb") {
    return `${(valueKg * 2.20462).toFixed(1)} lb`;
  }
  return `${valueKg.toFixed(1)} kg`;
}

export function clampPercent(value: number): number {
  if (Number.isNaN(value) || !Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(100, value));
}
