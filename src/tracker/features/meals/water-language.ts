import { requestedBulkingTargets } from './target-language';
/** Conservative local parsing used to verify a target change and recognize demo water portions. */
const words: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, half: 0.5 };
const volumePattern = /(?<![\w.\-])((?:\d[\d,]*(?:\.\d+)?|one|two|three|four|five|half))\s*(ml|millilit(?:er|re)s?|lit(?:er|re)s?|l)\b/gi;

function numeric(text: string): number {
  return words[text.toLowerCase()] ?? Number(text.replace(/,/g, ''));
}
function metricVolumes(text: string): number[] {
  return [...text.matchAll(volumePattern)].map((m) => numeric(m[1]!) * (/^m/i.test(m[2]!) ? 1 : 1000));
}

/** Exactly one stated value associated with an explicit water-goal change, not a question or suggestion. */
export function requestedWaterTargetMl(message: string): number | null {
  return requestedBulkingTargets(message)?.water ?? null;
}

/** Only plain water with a stated metric volume. */
export function waterPortion(message: string): { waterMl: number; assumed: boolean } | null {
  if (/\b(?:don't|do not|never|not|if|maybe)\b/i.test(message)) return null;
  if (!/\b(?:log|record|add|drank|drink|drunk|had|consumed)\b/i.test(message) || /\b(?:target|goal)\b/i.test(message)) return null;
  if (!/\bwater\b/i.test(message) || /\b(?:coconut|flavou?red|sugar|salt|rose|lemon|juice)\s+water\b/i.test(message)) return null;
  const volumes = metricVolumes(message);
  const direct = /(?:\d[\d,]*(?:\.\d+)?|one|two|three|four|five|half)\s*(?:ml|millilit(?:er|re)s?|lit(?:er|re)s?|l)\s*(?:of\s+)?water\b|\bwater\s*(?:(?:was|is|of|intake)\s*)?[:=]?\s*(?:\d[\d,]*(?:\.\d+)?|one|two|three|four|five|half)\s*(?:ml|millilit(?:er|re)s?|lit(?:er|re)s?|l)\b/i.test(message);
  if (direct && volumes.length === 1 && Number.isFinite(volumes[0]) && volumes[0]! > 0 && volumes[0]! <= 100_000) return { waterMl: volumes[0]!, assumed: false };
  return null;
}

/** Link a bare volume only to the immediately preceding unanswered water request. */
export function resolveWaterFollowUp(message: string, previousUser: string | undefined, previousAssistant: string | undefined): string {
  if (!previousUser || !previousAssistant || !/^\s*(?:\d[\d,]*(?:\.\d+)?|one|two|three|four|five|half)\s*(?:ml|millilit(?:er|re)s?|lit(?:er|re)s?|l)\s*[.!]?\s*$/i.test(message)) return message;
  if (!/\bwater\b/i.test(previousUser) || !/\b(?:water|volume|amount|litres?|liters?|ml)\b/i.test(previousAssistant) || !/\?/.test(previousAssistant)) return message;
  if (waterPortion(previousUser) || requestedWaterTargetMl(previousUser)) return message;
  return /\b(?:target|goal)\b/i.test(previousUser) ? `${previousUser} ${message}` : `${previousUser} ${message.replace(/[.!]$/, '')} of water`;
}
