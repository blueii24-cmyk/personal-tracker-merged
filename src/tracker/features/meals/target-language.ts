/** Explicitly requested daily targets. Undefined means not mentioned; null means ambiguous or invalid. */
export interface RequestedBulkingTargets {
  calories?: number | null;
  protein?: number | null;
  water?: number | null;
}

const numberPattern = /(?<![\w.\-])(?:\d[\d,]*(?:\.\d+)?|one|two|three|four|five|half)(?![\d.])/gi;
const volumePattern = /(?<![\w.\-])(\d[\d,]*(?:\.\d+)?|one|two|three|four|five|half)\s*(ml|millilit(?:er|re)s?|lit(?:er|re)s?|l)\b/gi;
const words: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, half: 0.5 };
const numeric = (s: string) => words[s.toLowerCase()] ?? Number(s.replace(/,/g, ''));

/** Parse only explicit target requests; never turn advice, consumption or conflicting values into settings. */
export function requestedBulkingTargets(message: string): RequestedBulkingTargets | null {
  if (/\b(?:should|recommend|suggest|what|how|don't|dont|do not|never|not|if|maybe)\b/i.test(message)) return null;
  if (!/\b(?:set|change|update|make|adjust|keep|use|is)\b/i.test(message) || !/\b(?:targets?|goals?)\b/i.test(message)) return null;
  const group = /\b(?:bulking|daily|nutrition|health)\s+(?:targets|goals)\b/i.test(message);
  const clauses = message.split(/,(?!\d)|[;\n]|\b(?:and|but)\b/i);
  // A user may list labels without punctuation: bind each amount to its own label.
  const parts = clauses.flatMap((clause) => {
    const labels = [...clause.matchAll(/\b(?:calor(?:ie|ies)|protein|water)\b/gi)];
    if (labels.length < 2) return [clause];
    return labels.map((label, i) => clause.slice(i === 0 ? 0 : label.index, labels[i + 1]?.index));
  });
  const result: RequestedBulkingTargets = {};
  const specs = [
    { field: 'calories' as const, label: /\bcalor(?:ie|ies)\b/i },
    { field: 'protein' as const, label: /\bprotein\b/i },
    { field: 'water' as const, label: /\bwater\b/i },
  ];
  for (const { field, label } of specs) {
    const candidates = parts.filter((part) => label.test(part) && (/\b(?:targets?|goals?)\b/i.test(part) || group) && !/\b(?:drank|drink|drunk|consumed|intake)\b/i.test(part));
    if (!candidates.length) continue;
    if (candidates.length !== 1) { result[field] = null; continue; }
    const part = candidates[0]!;
    if (field === 'water') {
      const volumes = [...part.matchAll(volumePattern)];
      if (volumes.length !== 1 || [...part.matchAll(numberPattern)].length !== 1) { result.water = null; continue; }
      const volume = numeric(volumes[0]![1]!) * (/^m/i.test(volumes[0]![2]!) ? 1 : 1000);
      result.water = Number.isFinite(volume) && volume > 0 && volume <= 100_000 ? volume : null;
    } else {
      const numbers = [...part.matchAll(numberPattern)];
      if (numbers.length !== 1) { result[field] = null; continue; }
      const value = numeric(numbers[0]![0]);
      result[field] = Number.isFinite(value) && (field === 'calories' ? Number.isInteger(value) && value >= 1 && value <= 20_000 : value >= 0 && value <= 1000) ? value : null;
    }
  }
  return Object.keys(result).length ? result : null;
}

/** Deterministic routing for target requests involving calories or protein. */
export function isBulkingTargetRequest(message: string): boolean {
  const targets = requestedBulkingTargets(message);
  return targets !== null && (targets.calories !== undefined || targets.protein !== undefined);
}
