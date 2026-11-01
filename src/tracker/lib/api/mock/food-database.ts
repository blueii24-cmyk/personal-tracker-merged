import type { FoodItemInput } from '@/tracker/types/domain';

/**
 * A tiny, approximate food table used ONLY by the demo assistant.
 * Values are rough per-serving estimates and are always flagged as estimates in the UI.
 */
export interface FoodEntry {
  id: string;
  name: string;
  aliases: string[];
  /** Native serving unit (singular) and its plural. */
  unit: string;
  unitPlural: string;
  kcal: number;
  proteinG: number;
  /** Grams (or ml) in one native unit, so "150 g" and "200 ml" can be converted. */
  gramsPerUnit?: number;
  /** Other portion words that count as one native unit (e.g. cup ≈ glass). */
  equivalentUnits?: string[];
}

export const FOODS: FoodEntry[] = [
  { id: 'egg', name: 'Egg', aliases: ['egg', 'eggs', 'boiled egg', 'boiled eggs', 'omelette', 'omelet'], unit: 'piece', unitPlural: 'pieces', kcal: 78, proteinG: 6.3, gramsPerUnit: 50 },
  { id: 'banana', name: 'Banana', aliases: ['banana', 'bananas'], unit: 'piece', unitPlural: 'pieces', kcal: 105, proteinG: 1.3, gramsPerUnit: 118 },
  { id: 'milk', name: 'Milk', aliases: ['milk', 'glass of milk'], unit: 'glass', unitPlural: 'glasses', kcal: 150, proteinG: 8, gramsPerUnit: 250, equivalentUnits: ['cup', 'cups'] },
  { id: 'roti', name: 'Roti', aliases: ['roti', 'rotis', 'chapati', 'chapatis', 'chapathi', 'phulka'], unit: 'piece', unitPlural: 'pieces', kcal: 104, proteinG: 3, gramsPerUnit: 40 },
  { id: 'rice', name: 'Cooked rice', aliases: ['rice', 'cooked rice', 'white rice'], unit: 'bowl', unitPlural: 'bowls', kcal: 205, proteinG: 4.3, gramsPerUnit: 158, equivalentUnits: ['cup', 'cups', 'plate', 'plates'] },
  { id: 'dal', name: 'Dal', aliases: ['dal', 'daal', 'lentils', 'lentil curry'], unit: 'bowl', unitPlural: 'bowls', kcal: 180, proteinG: 9, gramsPerUnit: 200, equivalentUnits: ['cup', 'cups'] },
  { id: 'rajma', name: 'Rajma', aliases: ['rajma', 'kidney beans'], unit: 'bowl', unitPlural: 'bowls', kcal: 210, proteinG: 12, gramsPerUnit: 200, equivalentUnits: ['cup', 'cups'] },
  { id: 'chicken', name: 'Chicken breast', aliases: ['chicken breast', 'chicken', 'grilled chicken'], unit: 'g', unitPlural: 'g', kcal: 1.65, proteinG: 0.31, gramsPerUnit: 1 },
  { id: 'paneer', name: 'Paneer', aliases: ['paneer', 'cottage cheese'], unit: 'g', unitPlural: 'g', kcal: 2.65, proteinG: 0.18, gramsPerUnit: 1 },
  { id: 'peanut-butter', name: 'Peanut butter', aliases: ['peanut butter'], unit: 'tbsp', unitPlural: 'tbsp', kcal: 94, proteinG: 4, gramsPerUnit: 16, equivalentUnits: ['tablespoon', 'tablespoons'] },
  { id: 'peanuts', name: 'Peanuts', aliases: ['peanuts', 'peanut', 'groundnuts'], unit: 'handful', unitPlural: 'handfuls', kcal: 170, proteinG: 7.5, gramsPerUnit: 30 },
  { id: 'almonds', name: 'Almonds', aliases: ['almonds', 'almond'], unit: 'handful', unitPlural: 'handfuls', kcal: 165, proteinG: 6, gramsPerUnit: 28 },
  { id: 'oats', name: 'Oats (cooked)', aliases: ['oats', 'oatmeal', 'porridge'], unit: 'bowl', unitPlural: 'bowls', kcal: 160, proteinG: 5.5, gramsPerUnit: 240, equivalentUnits: ['cup', 'cups'] },
  { id: 'bread', name: 'Bread', aliases: ['bread', 'toast', 'bread slice', 'bread slices'], unit: 'slice', unitPlural: 'slices', kcal: 80, proteinG: 3, gramsPerUnit: 30 },
  { id: 'curd', name: 'Curd', aliases: ['curd', 'yogurt', 'yoghurt', 'dahi'], unit: 'bowl', unitPlural: 'bowls', kcal: 100, proteinG: 5.5, gramsPerUnit: 150, equivalentUnits: ['cup', 'cups'] },
  { id: 'whey', name: 'Whey protein', aliases: ['whey protein', 'whey', 'protein shake', 'protein powder'], unit: 'scoop', unitPlural: 'scoops', kcal: 120, proteinG: 24, gramsPerUnit: 30 },
  { id: 'apple', name: 'Apple', aliases: ['apple', 'apples'], unit: 'piece', unitPlural: 'pieces', kcal: 95, proteinG: 0.5, gramsPerUnit: 180 },
  { id: 'dosa', name: 'Dosa', aliases: ['dosa', 'dosas'], unit: 'piece', unitPlural: 'pieces', kcal: 133, proteinG: 3.2 },
  { id: 'idli', name: 'Idli', aliases: ['idli', 'idlis'], unit: 'piece', unitPlural: 'pieces', kcal: 58, proteinG: 2 },
  { id: 'poha', name: 'Poha', aliases: ['poha'], unit: 'plate', unitPlural: 'plates', kcal: 270, proteinG: 5, equivalentUnits: ['bowl', 'bowls'] },
  { id: 'samosa', name: 'Samosa', aliases: ['samosa', 'samosas'], unit: 'piece', unitPlural: 'pieces', kcal: 260, proteinG: 4 },
];

const WORD_NUMBERS: Record<string, number> = {
  a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12,
  half: 0.5, couple: 2,
};
const UNIT_WORDS = [
  'glasses', 'glass', 'cups', 'cup', 'bowls', 'bowl', 'plates', 'plate', 'slices', 'slice', 'pieces', 'piece', 'pcs', 'pc',
  'tablespoons', 'tablespoon', 'tbsp', 'scoops', 'scoop', 'handfuls', 'handful', 'grams', 'gram', 'gms', 'gm', 'g', 'kg', 'ml',
];

const MASS_UNITS = new Set(['g', 'gm', 'gms', 'gram', 'grams', 'ml']);

export interface ParsedFoodSegment {
  /** Original, cleaned phrase (for unknown foods). */
  phrase: string;
  food: FoodEntry | null;
  quantity: number | null;
  unit: string | null;
  /** True when the user gave no portion, so one native serving was assumed. */
  assumedPortion: boolean;
}

const VERB_PREFIX = /^(?:(?:i|we)\s+)?(?:just\s+|also\s+|then\s+|had\s+|have\s+|ate\s+|eaten\s+|eat\s+|drank\s+|drink\s+|drunk\s+|consumed\s+|took\s+|having\s+|eating\s+|and\s+)+/;

export function parseFoodSegment(raw: string): ParsedFoodSegment | null {
  let s = raw.toLowerCase().replace(/[.!?]+$/g, '').trim();
  s = s.replace(VERB_PREFIX, '').replace(VERB_PREFIX, '').trim();
  s = s.replace(/^(?:some|my)\s+/, '');
  if (!s) return null;

  let quantity: number | null = null;
  let unit: string | null = null;

  const qty = s.match(/^(\d+(?:\.\d+)?|\d+\/\d+|a couple of|a|an|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|half(?: a)?)(?=\s|\d|[a-z]|$)\s*/);
  if (qty) {
    const token = qty[1]!;
    if (token.includes('/')) {
      const [n, d] = token.split('/').map(Number) as [number, number];
      quantity = d ? n / d : null;
    } else if (/^\d/.test(token)) quantity = Number(token);
    else quantity = WORD_NUMBERS[token.replace(/ a$/, '').replace('a couple of', 'couple')] ?? 1;
    s = s.slice(qty[0].length);
  }
  const unitMatch = s.match(new RegExp(`^(${UNIT_WORDS.join('|')})\\b\\s*(?:of\\s+)?`));
  if (unitMatch && quantity != null) {
    unit = unitMatch[1]!;
    s = s.slice(unitMatch[0].length);
  }
  s = s.replace(/^of\s+/, '').trim();
  if (!s) return null;

  const food = matchFood(s);
  return { phrase: s, food, quantity, unit, assumedPortion: quantity == null };
}

function matchFood(phrase: string): FoodEntry | null {
  let best: { food: FoodEntry; len: number } | null = null;
  for (const food of FOODS) {
    for (const alias of food.aliases) {
      const re = new RegExp(`(^|\\b)${alias.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\b|$)`);
      if (re.test(phrase) && (!best || alias.length > best.len)) best = { food, len: alias.length };
    }
  }
  return best?.food ?? null;
}

/** Convert a parsed segment into a food item with estimated nutrition (or unknown nutrition). */
export function toFoodItem(seg: ParsedFoodSegment): FoodItemInput {
  const food = seg.food;
  if (!food) {
    return {
      foodName: titleCase(seg.phrase),
      quantity: seg.quantity,
      unit: seg.unit,
      caloriesKcal: null,
      proteinG: null,
      isEstimate: true,
      nutritionSource: 'unknown',
    };
  }
  let qty = seg.quantity ?? 1;
  // Gram-based foods with no stated portion: assume 100 g per count rather than 1 g.
  if (food.unit === 'g' && !seg.unit) {
    qty = qty * 100;
    seg = { ...seg, quantity: qty, unit: 'g' };
  }
  let units = qty; // in native units
  let shownUnit = seg.unit ?? (qty === 1 ? food.unit : food.unitPlural);
  if (seg.unit) {
    const u = seg.unit;
    if (MASS_UNITS.has(u) || u === 'kg') {
      const grams = u === 'kg' ? qty * 1000 : qty;
      units = food.gramsPerUnit ? grams / food.gramsPerUnit : qty;
      shownUnit = u === 'kg' ? 'kg' : u === 'ml' ? 'ml' : 'g';
    } else if (u === food.unit || u === food.unitPlural || food.equivalentUnits?.includes(u)) {
      units = qty;
    } else {
      units = qty; // unfamiliar unit: assume one native unit per count
    }
  }
  const kcal = Math.round(units * food.kcal * 10) / 10;
  const protein = Math.round(units * food.proteinG * 10) / 10;
  return {
    foodName: food.name,
    quantity: qty,
    unit: shownUnit,
    caloriesKcal: Math.round(kcal),
    proteinG: protein,
    isEstimate: true,
    nutritionSource: 'ai_estimate',
  };
}

/** Build an item directly from the table (used for seed data). */
export function itemFromFood(foodId: string, quantity: number, unit?: string): FoodItemInput {
  const food = FOODS.find((f) => f.id === foodId);
  if (!food) throw new Error(`Unknown seed food ${foodId}`);
  return toFoodItem({ phrase: food.name, food, quantity, unit: unit ?? null, assumedPortion: false });
}

function titleCase(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}
