import type { MealType, TransactionType, WeightUnit } from "@/server/compat/domain";
import { round } from "@/lib/utils";

const MONTHS_SHORT = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

/* Currency ---------------------------------------------------------------- */

export function formatINR(value: number, options?: { decimals?: boolean; signed?: boolean }): string {
  const safe = Number.isFinite(value) ? value : 0;
  const decimals = options?.decimals ?? !Number.isInteger(safe);
  const formatted = new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: decimals ? 2 : 0,
    minimumFractionDigits: decimals ? 2 : 0,
  }).format(Math.abs(safe));
  const sign = safe < 0 ? "−" : options?.signed && safe > 0 ? "+" : "";
  return `${sign}₹${formatted}`;
}

export function formatCompactINR(value: number): string {
  const safe = Number.isFinite(value) ? Math.abs(value) : 0;
  if (safe >= 100000) return `₹${round(safe / 100000, 1)}L`;
  if (safe >= 1000) return `₹${round(safe / 1000, safe >= 10000 ? 0 : 1)}k`;
  return `₹${Math.round(safe)}`;
}

/* Numbers ---------------------------------------------------------------- */

export function formatNumber(value: number, decimals = 0): string {
  const safe = Number.isFinite(value) ? value : 0;
  return new Intl.NumberFormat("en-IN", {
    maximumFractionDigits: decimals,
    minimumFractionDigits: 0,
  }).format(safe);
}

export function formatCalories(value: number): string {
  return `${formatNumber(Math.round(value))} kcal`;
}

export function formatGrams(value: number): string {
  return `${formatNumber(round(value, 1), 1)} g`;
}

export function formatWeight(value: number, unit: WeightUnit = "kg"): string {
  const display = unit === "lb" ? value * 2.20462 : value;
  return `${round(display, 1).toFixed(1)} ${unit}`;
}

export function formatPercent(value: number, decimals = 0): string {
  const safe = Number.isFinite(value) ? value : 0;
  return `${round(safe, decimals).toFixed(decimals)}%`;
}

/* Dates ------------------------------------------------------------------ */

export function parseISODate(iso: string): Date {
  const [year, month, day] = iso.split("-").map(Number);
  if (!year || !month || !day) return new Date();
  return new Date(year, month - 1, day);
}

export function toISODate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function todayISO(now: Date = new Date()): string {
  return toISODate(now);
}

export function addDaysISO(iso: string, days: number): string {
  const date = parseISODate(iso);
  date.setDate(date.getDate() + days);
  return toISODate(date);
}

export function isValidISODate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = parseISODate(value);
  return toISODate(date) === value;
}

export function formatDateHuman(iso: string, today: string = todayISO()): string {
  if (!iso) return "—";
  if (iso === today) return "Today";
  if (iso === addDaysISO(today, -1)) return "Yesterday";
  const date = parseISODate(iso);
  const sameYear = date.getFullYear() === parseISODate(today).getFullYear();
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}${sameYear ? "" : ` ${date.getFullYear()}`}`;
}

export function formatShortDate(iso: string): string {
  const date = parseISODate(iso);
  return `${date.getDate()} ${MONTHS_SHORT[date.getMonth()]}`;
}

export function formatDateFull(iso: string): string {
  const date = parseISODate(iso);
  return `${WEEKDAYS[date.getDay()]}, ${date.getDate()} ${MONTHS_SHORT[date.getMonth()]} ${date.getFullYear()}`;
}

export function formatWeekday(iso: string): string {
  return WEEKDAYS[parseISODate(iso).getDay()].slice(0, 3);
}

export function formatTime(isoTimestamp: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return "—";
  return date
    .toLocaleTimeString("en-IN", { hour: "numeric", minute: "2-digit", hour12: true })
    .toLowerCase();
}

export function formatChatTimestamp(isoTimestamp: string, today: string): string {
  const date = new Date(isoTimestamp);
  if (Number.isNaN(date.getTime())) return "";
  if (toISODate(date) === today) return formatTime(isoTimestamp);
  return `${formatDateHuman(toISODate(date), today)}, ${formatTime(isoTimestamp)}`;
}

export function greetingForHour(hour: number): string {
  if (hour < 5) return "Still up";
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

/* Months ----------------------------------------------------------------- */

export function monthKeyOf(iso: string): string {
  return iso.slice(0, 7);
}

export function currentMonth(today: string): string {
  return monthKeyOf(today);
}

export function monthLabel(month: string, short = false): string {
  const [year, monthNumber] = month.split("-").map(Number);
  if (!year || !monthNumber) return month;
  const name = MONTHS_SHORT[monthNumber - 1] ?? "";
  return short ? `${name} ${String(year).slice(2)}` : `${name} ${year}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [year, monthNumber] = month.split("-").map(Number);
  const date = new Date(year, monthNumber - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function lastNMonths(endMonth: string, count: number): string[] {
  return Array.from({ length: count }, (_, index) => shiftMonth(endMonth, -(count - 1 - index)));
}

export function monthRange(month: string): { start: string; end: string } {
  const [year, monthNumber] = month.split("-").map(Number);
  const start = `${month}-01`;
  const lastDay = new Date(year, monthNumber, 0).getDate();
  return { start, end: `${month}-${String(lastDay).padStart(2, "0")}` };
}

/* Labels ----------------------------------------------------------------- */

export const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snacks",
};

export function mealLabel(type: MealType): string {
  return MEAL_LABELS[type] ?? "Meal";
}

export function transactionLabel(type: TransactionType): string {
  return type === "income" ? "Income" : "Expense";
}

export function pluralize(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}
