/** Money helpers. All arithmetic goes through integer paise to avoid float drift. */

const MINUS = '−'; // true minus sign

export function toPaise(rupees: number): number {
  return Math.round(rupees * 100);
}
export function fromPaise(paise: number): number {
  return paise / 100;
}
export function roundMoney(rupees: number): number {
  return fromPaise(toPaise(rupees));
}
export function sumMoney(values: readonly number[]): number {
  let paise = 0;
  for (const v of values) paise += toPaise(v);
  return fromPaise(paise);
}
export function subtractMoney(a: number, b: number): number {
  return fromPaise(toPaise(a) - toPaise(b));
}

const formatters = new Map<number, Intl.NumberFormat>();
function nf(fractionDigits: 0 | 2): Intl.NumberFormat {
  let f = formatters.get(fractionDigits);
  if (!f) {
    f = new Intl.NumberFormat('en-IN', {
      style: 'currency',
      currency: 'INR',
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    formatters.set(fractionDigits, f);
  }
  return f;
}

/** ₹1,25,000 — paise are shown only when present. Negative values use a true minus sign. */
export function formatRupees(amount: number): string {
  const rounded = roundMoney(amount);
  const hasPaise = toPaise(rounded) % 100 !== 0;
  const abs = nf(hasPaise ? 2 : 0).format(Math.abs(rounded));
  return rounded < 0 ? `${MINUS}${abs}` : abs;
}

/** `−₹60` for expenses, `+₹2,000` for income. */
export function formatSignedRupees(amount: number, type: 'income' | 'expense'): string {
  const abs = formatRupees(Math.abs(amount));
  return type === 'expense' ? `${MINUS}${abs}` : `+${abs}`;
}

/** Short form for chart axes: ₹500, ₹2k, ₹1.5L. */
export function formatCompactRupees(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? MINUS : '';
  if (abs >= 10_000_000) return `${sign}₹${trim(abs / 10_000_000)}Cr`;
  if (abs >= 100_000) return `${sign}₹${trim(abs / 100_000)}L`;
  if (abs >= 1000) return `${sign}₹${trim(abs / 1000)}k`;
  return `${sign}₹${trim(abs)}`;
}
function trim(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(1).replace(/\.0$/, '');
}
