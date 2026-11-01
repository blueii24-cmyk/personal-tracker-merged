import { addDays, dateKeyInTz, zonedToIso } from '@/tracker/lib/formatting/dates';
import type { ChatMessage, ChatSession, Meal, MealType, Transaction, TransactionCategory, UserSettings, WeighIn } from '@/tracker/types/domain';
import type { CalendarEvent, CalendarPrefs } from '@/tracker/types/calendar';
import { itemFromFood } from './food-database';

/**
 * Deterministic demo data, generated as offsets from "today" in the user's timezone so the dashboard
 * always has recent records. Replace this file (or the mock service) with real data later.
 * Nothing here is ever sent to a server.
 */
export interface DemoDb {
  version: 1;
  meals: Meal[];
  transactions: Transaction[];
  weighIns: WeighIn[];
  settings: UserSettings;
  sessions: ChatSession[];
  messages: Array<ChatMessage & { sessionId: string }>;
  /** User-created and Google-synced calendar events. Optional so databases saved before the calendar existed still load. */
  calendarEvents?: CalendarEvent[];
  calendarPrefs?: CalendarPrefs;
  /** clientMessageId → stored reply, so a retried submit never duplicates records. */
  processed: Record<string, unknown>;
}

export const DEMO_SETTINGS: UserSettings = {
  displayName: 'Alex',
  email: 'demo@personal-tracker.local',
  timezone: 'Asia/Kolkata',
  currency: 'INR',
  openingBalance: 9000,
  // Sample values for the demo only — set your own in Settings.
  dailyCalorieTarget: 2800,
  dailyProteinTargetG: 100,
  monthlyBudget: 6000,
  targetWeightKg: null,
  weightUnit: 'kg',
  preferredAiProvider: 'demo',
  preferredAiModel: null,
};

type FoodSpec = [foodId: string, qty: number, unit?: string];
const MEAL_TEMPLATES: Record<Exclude<MealType, 'other'>, FoodSpec[][]> = {
  breakfast: [
    [['egg', 3], ['banana', 2], ['milk', 1]],
    [['oats', 1], ['banana', 1], ['peanut-butter', 2]],
    [['dosa', 2], ['milk', 1]],
    [['poha', 1], ['milk', 1], ['banana', 1]],
    [['bread', 4], ['egg', 2], ['peanut-butter', 1]],
  ],
  lunch: [
    [['rice', 2], ['dal', 1], ['paneer', 100, 'g']],
    [['roti', 4], ['rajma', 1], ['curd', 1]],
    [['rice', 2], ['chicken', 150, 'g'], ['dal', 1]],
    [['roti', 3], ['dal', 1], ['paneer', 100, 'g'], ['curd', 1]],
    [['rice', 2], ['rajma', 1], ['curd', 1]],
  ],
  snack: [
    [['peanuts', 1], ['banana', 1]],
    [['whey', 1], ['milk', 1]],
    [['almonds', 1], ['apple', 1]],
    [['bread', 2], ['peanut-butter', 1]],
    [['samosa', 1], ['milk', 1]],
  ],
  dinner: [
    [['roti', 3], ['chicken', 150, 'g'], ['dal', 1]],
    [['rice', 2], ['paneer', 120, 'g'], ['dal', 1]],
    [['roti', 4], ['egg', 3], ['curd', 1]],
    [['rice', 2], ['chicken', 120, 'g']],
    [['roti', 3], ['rajma', 1]],
  ],
};
const MEAL_TIMES: Record<Exclude<MealType, 'other'>, string> = { breakfast: '08:15', lunch: '13:10', snack: '17:20', dinner: '20:45' };

function dayOfWeek(key: string): number {
  const [y, m, d] = key.split('-').map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function buildSeedDb(now: Date = new Date()): DemoDb {
  const tz = DEMO_SETTINGS.timezone;
  const today = dateKeyInTz(now, tz);
  const meals: Meal[] = [];
  const transactions: Transaction[] = [];
  const weighIns: WeighIn[] = [];
  const nowMs = now.getTime();
  const at = (key: string, time: string) => zonedToIso(key, time, tz);
  const past = (iso: string) => new Date(iso).getTime() < nowMs - 10 * 60_000;

  let tn = 0;
  const addTx = (key: string, time: string, type: Transaction['type'], amount: number, category: TransactionCategory, description: string, merchant: string | null = null) => {
    const occurredAt = at(key, time);
    if (!past(occurredAt)) return;
    tn += 1;
    transactions.push({
      id: `demo-tx-${tn}`, type, amount, currency: 'INR', category, description, merchant, notes: null, occurredAt,
      source: tn % 4 === 0 ? 'ai' : 'manual',
    });
  };

  let mn = 0;
  for (let i = 0; i < 62; i++) {
    const key = addDays(today, -i);
    const dow = dayOfWeek(key);
    const dom = Number(key.slice(8, 10));
    const weekday = dow >= 1 && dow <= 5;

    (Object.keys(MEAL_TEMPLATES) as Array<keyof typeof MEAL_TEMPLATES>).forEach((type, ti) => {
      const options = MEAL_TEMPLATES[type];
      const spec = options[(i * 3 + ti * 2) % options.length]!;
      const eatenAt = at(key, MEAL_TIMES[type]);
      if (!past(eatenAt)) return;
      mn += 1;
      meals.push({
        id: `demo-meal-${mn}`,
        mealType: type,
        eatenAt,
        notes: null,
        source: mn % 3 === 0 ? 'ai' : 'manual',
        items: spec.map(([food, qty, unit], idx) => ({ id: `demo-meal-${mn}-item-${idx + 1}`, ...itemFromFood(food, qty, unit) })),
      });
    });

    if (weekday) {
      addTx(key, '08:00', 'expense', 30, 'transport', 'Bus to college', 'City bus');
      addTx(key, '17:30', 'expense', 30, 'transport', 'Bus home', 'City bus');
      addTx(key, '13:15', 'expense', 60 + ((i * 13) % 50), 'food', 'Canteen lunch', 'College canteen');
    }
    if (i % 14 === 5) addTx(key, '19:00', 'expense', 350, 'entertainment', 'Movie ticket', 'PVR');
    if (i % 21 === 9) addTx(key, '16:30', 'expense', 899, 'shopping', 'T-shirt', 'Max Fashion');
    if (dom === 1) addTx(key, '10:00', 'income', 4000, 'pocket_money', 'Monthly pocket money');
    if (dom === 3) addTx(key, '11:00', 'expense', 239, 'mobile_recharge', 'Mobile recharge', 'Jio');
    if (dom === 7) addTx(key, '09:00', 'expense', 149, 'subscriptions', 'Music subscription', 'Spotify');
    if (dom === 12) addTx(key, '15:00', 'expense', 450, 'college', 'Stationery and printouts');
    if (dom === 20) addTx(key, '12:00', 'income', 500, 'gift', 'Birthday gift from uncle');
  }

  // A weigh-in every third day, ending yesterday or earlier, trending gently up with small noise.
  const noise = [0, 0.15, -0.1, 0.2, -0.05, 0.1, -0.15, 0.05];
  let wn = 0;
  for (let i = 60; i >= 1; i -= 3) {
    const key = addDays(today, -i);
    const base = 46.9 + ((60 - i) / 60) * 1.0;
    wn += 1;
    weighIns.push({
      id: `demo-weight-${wn}`,
      weightKg: Math.round((base + noise[wn % noise.length]!) * 10) / 10,
      recordedAt: at(key, '07:05'),
      notes: null,
      source: 'manual',
    });
  }

  return {
    version: 1,
    meals: meals.sort((a, b) => a.eatenAt.localeCompare(b.eatenAt)),
    transactions: transactions.sort((a, b) => a.occurredAt.localeCompare(b.occurredAt)),
    weighIns,
    settings: { ...DEMO_SETTINGS },
    sessions: [],
    messages: [],
    processed: {},
  };
}
