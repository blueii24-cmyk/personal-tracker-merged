/**
 * Pure helpers for the on-device database: versioned migration, record validation and backup parsing.
 * Nothing here touches storage, so every rule can be unit-tested.
 */
import { roundMoney } from '@/tracker/lib/formatting/currency';
import { isValidTimezone } from '@/tracker/lib/formatting/dates';
import {
  EXPENSE_CATEGORIES, INCOME_CATEGORIES, MEAL_TYPES,
  type ChatMessage, type ChatSession, type FoodItem, type Meal, type Transaction, type UserSettings, type WeighIn,
} from '@/tracker/types/domain';
import type { ExportBundle } from '../tracker-service';
import { DEMO_SETTINGS, type DemoDb } from './seed';

export const DB_VERSION = 1;
export const BACKUP_APP = 'personal-tracker';
export const BACKUP_FORMAT_VERSION = 1;
export const MAX_BACKUP_BYTES = 25 * 1024 * 1024;

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === 'string';
const isNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const validIso = (v: unknown): v is string => isStr(v) && v.length >= 10 && !Number.isNaN(Date.parse(v));
const strOrNull = (v: unknown): string | null => (isStr(v) ? v : null);
/** `null`/missing → null (unknown). A finite number in range → itself. Anything else → undefined (invalid). */
function optNum(v: unknown, max: number): number | null | undefined {
  if (v == null) return null;
  return isNum(v) && v >= 0 && v <= max ? v : undefined;
}

const NUTRITION_SOURCES = ['ai_estimate', 'label', 'verified_database', 'user_entered', 'unknown'] as const;
const ALL_CATEGORIES: readonly string[] = [...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES];

function normalizeItem(raw: unknown, fallbackId: string): FoodItem | null {
  if (!isObj(raw) || !isStr(raw.foodName) || !raw.foodName.trim()) return null;
  const quantity = optNum(raw.quantity, 1_000_000);
  const kcal = optNum(raw.caloriesKcal, 100_000);
  const protein = optNum(raw.proteinG, 10_000);
  if (quantity === undefined || kcal === undefined || protein === undefined) return null;
  return {
    id: isStr(raw.id) && raw.id ? raw.id : fallbackId,
    foodName: raw.foodName.trim(),
    quantity,
    unit: strOrNull(raw.unit),
    caloriesKcal: kcal,
    proteinG: protein,
    isEstimate: raw.isEstimate === true,
    nutritionSource: NUTRITION_SOURCES.includes(raw.nutritionSource as never) ? (raw.nutritionSource as FoodItem['nutritionSource']) : 'unknown',
  };
}

export function normalizeMeal(raw: unknown): Meal | null {
  if (!isObj(raw) || !isStr(raw.id) || !raw.id) return null;
  if (!MEAL_TYPES.includes(raw.mealType as never) || !validIso(raw.eatenAt)) return null;
  if (!Array.isArray(raw.items) || raw.items.length < 1 || raw.items.length > 25) return null;
  const items: FoodItem[] = [];
  for (let i = 0; i < raw.items.length; i++) {
    const it = normalizeItem(raw.items[i], `${raw.id}-${i}`);
    if (!it) return null;
    items.push(it);
  }
  return { id: raw.id, mealType: raw.mealType as Meal['mealType'], eatenAt: raw.eatenAt, notes: strOrNull(raw.notes), source: raw.source === 'ai' ? 'ai' : 'manual', items };
}

export function normalizeTransaction(raw: unknown): Transaction | null {
  if (!isObj(raw) || !isStr(raw.id) || !raw.id) return null;
  if (raw.type !== 'income' && raw.type !== 'expense') return null;
  if (!isNum(raw.amount) || !(raw.amount > 0) || raw.amount > 100_000_000) return null;
  if (!validIso(raw.occurredAt)) return null;
  return {
    id: raw.id,
    type: raw.type,
    amount: roundMoney(raw.amount),
    currency: 'INR',
    category: (isStr(raw.category) && ALL_CATEGORIES.includes(raw.category) ? raw.category : 'other') as Transaction['category'],
    description: isStr(raw.description) && raw.description.trim() ? raw.description : 'Transaction',
    merchant: strOrNull(raw.merchant),
    notes: strOrNull(raw.notes),
    occurredAt: raw.occurredAt,
    source: raw.source === 'ai' ? 'ai' : 'manual',
  };
}

export function normalizeWeighIn(raw: unknown): WeighIn | null {
  if (!isObj(raw) || !isStr(raw.id) || !raw.id) return null;
  if (!isNum(raw.weightKg) || raw.weightKg < 1 || raw.weightKg > 1000 || !validIso(raw.recordedAt)) return null;
  return { id: raw.id, weightKg: raw.weightKg, recordedAt: raw.recordedAt, notes: strOrNull(raw.notes), source: raw.source === 'ai' ? 'ai' : 'manual' };
}

export function normalizeSettings(raw: unknown): UserSettings {
  const base: UserSettings = { ...DEMO_SETTINGS };
  if (!isObj(raw)) return base;
  const target = (v: unknown, max: number, fallback: number | null): number | null => {
    if (v === null) return null;
    return isNum(v) && v >= 0 && v <= max ? v : fallback;
  };
  return {
    displayName: isStr(raw.displayName) ? raw.displayName.slice(0, 60) : base.displayName,
    email: isStr(raw.email) ? raw.email : base.email,
    timezone: isStr(raw.timezone) && isValidTimezone(raw.timezone) ? raw.timezone : base.timezone,
    currency: 'INR',
    openingBalance: isNum(raw.openingBalance) && Math.abs(raw.openingBalance) <= 1_000_000_000 ? raw.openingBalance : 0,
    dailyCalorieTarget: target(raw.dailyCalorieTarget, 100_000, base.dailyCalorieTarget),
    dailyProteinTargetG: target(raw.dailyProteinTargetG, 10_000, base.dailyProteinTargetG),
    monthlyBudget: target(raw.monthlyBudget, 1_000_000_000, base.monthlyBudget),
    targetWeightKg: target(raw.targetWeightKg, 1000, base.targetWeightKg),
    weightUnit: raw.weightUnit === 'lb' ? 'lb' : raw.weightUnit === 'kg' ? 'kg' : base.weightUnit,
    preferredAiProvider: isStr(raw.preferredAiProvider) ? (raw.preferredAiProvider as UserSettings['preferredAiProvider']) : base.preferredAiProvider,
    preferredAiModel: strOrNull(raw.preferredAiModel),
  };
}

function normalizeSession(raw: unknown): ChatSession | null {
  if (!isObj(raw) || !isStr(raw.id) || !isStr(raw.title) || !validIso(raw.createdAt) || !validIso(raw.updatedAt)) return null;
  return raw as unknown as ChatSession;
}
function normalizeMessage(raw: unknown): (ChatMessage & { sessionId: string }) | null {
  if (!isObj(raw) || !isStr(raw.id) || !isStr(raw.sessionId) || !isStr(raw.content) || !validIso(raw.createdAt)) return null;
  if (raw.role !== 'user' && raw.role !== 'assistant') return null;
  return raw as unknown as ChatMessage & { sessionId: string };
}

/** Keeps `processed` (the chat idempotency log) from growing forever. Insertion order = age. */
export function pruneProcessed(processed: Record<string, unknown>, keep = 200): Record<string, unknown> {
  const keys = Object.keys(processed);
  if (keys.length <= keep) return processed;
  return Object.fromEntries(keys.slice(keys.length - keep).map((k) => [k, processed[k]]));
}

function mapValid<T>(list: unknown[], fn: (x: unknown) => T | null): { items: T[]; dropped: number } {
  const items: T[] = [];
  const seen = new Set<string>();
  let dropped = 0;
  for (const raw of list) {
    const v = fn(raw);
    const id = v && (v as { id?: string }).id;
    if (!v || (id && seen.has(id))) {
      dropped++;
      continue;
    }
    if (id) seen.add(id);
    items.push(v);
  }
  return { items, dropped };
}

/**
 * Turns whatever was found in storage into a current-version database.
 * Returns null when it can't be trusted at all (not JSON-shaped, or written by a NEWER app version) so the caller
 * can set the original aside instead of overwriting it. `dropped` counts individual records that failed validation.
 * To add a schema v2: bump DB_VERSION, then convert `parsed` to the v1 shape here before the checks below.
 */
export function migrateDb(parsed: unknown): { db: DemoDb; dropped: number } | null {
  if (!isObj(parsed) || parsed.version !== DB_VERSION) return null;
  if (!Array.isArray(parsed.meals) || !Array.isArray(parsed.transactions) || !Array.isArray(parsed.weighIns) || !isObj(parsed.settings)) return null;
  const meals = mapValid(parsed.meals, normalizeMeal);
  const transactions = mapValid(parsed.transactions, normalizeTransaction);
  const weighIns = mapValid(parsed.weighIns, normalizeWeighIn);
  const sessions = mapValid(Array.isArray(parsed.sessions) ? parsed.sessions : [], normalizeSession);
  const messages = mapValid(Array.isArray(parsed.messages) ? parsed.messages : [], normalizeMessage);
  return {
    db: {
      version: 1,
      meals: meals.items,
      transactions: transactions.items,
      weighIns: weighIns.items,
      settings: normalizeSettings(parsed.settings),
      sessions: sessions.items,
      messages: messages.items,
      processed: isObj(parsed.processed) ? pruneProcessed(parsed.processed) : {},
    },
    dropped: meals.dropped + transactions.dropped + weighIns.dropped,
  };
}

export type BackupParse = { ok: true; bundle: ExportBundle } | { ok: false; error: string };

/** Strict: a backup is restored completely or not at all. Files exported by earlier versions (no format fields) are accepted. */
export function parseBackup(text: string): BackupParse {
  if (text.length > MAX_BACKUP_BYTES) return { ok: false, error: 'That file is too large to be a Personal Tracker backup.' };
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, error: "That file isn't valid JSON. Choose a file made with “Export everything (JSON)”." };
  }
  if (!isObj(data)) return { ok: false, error: "That file doesn't look like a Personal Tracker backup." };
  if (data.app !== undefined && data.app !== BACKUP_APP) return { ok: false, error: "That file wasn't made by Personal Tracker." };
  if (data.formatVersion !== undefined && (!isNum(data.formatVersion) || data.formatVersion > BACKUP_FORMAT_VERSION)) {
    return { ok: false, error: 'That backup was made by a newer version of the app. Update the app and try again.' };
  }
  if (!Array.isArray(data.meals) || !Array.isArray(data.transactions) || !Array.isArray(data.weighIns)) {
    return { ok: false, error: 'That backup is missing its meals, transactions or weigh-ins.' };
  }
  const check = <T extends { id: string },>(label: string, list: unknown[], fn: (x: unknown) => T | null): { items: T[] } | string => {
    const items: T[] = [];
    const seen = new Set<string>();
    for (let i = 0; i < list.length; i++) {
      const v = fn(list[i]);
      if (!v) return `${label} #${i + 1} in the file is invalid, so nothing was restored.`;
      const id = v.id;
      if (seen.has(id)) continue; // exact duplicate id: keep the first
      seen.add(id);
      items.push(v);
    }
    return { items };
  };
  const meals = check('Meal', data.meals, normalizeMeal);
  if (typeof meals === 'string') return { ok: false, error: meals };
  const transactions = check('Transaction', data.transactions, normalizeTransaction);
  if (typeof transactions === 'string') return { ok: false, error: transactions };
  const weighIns = check('Weigh-in', data.weighIns, normalizeWeighIn);
  if (typeof weighIns === 'string') return { ok: false, error: weighIns };
  return {
    ok: true,
    bundle: {
      app: BACKUP_APP,
      formatVersion: BACKUP_FORMAT_VERSION,
      exportedAt: isStr(data.exportedAt) && validIso(data.exportedAt) ? data.exportedAt : new Date().toISOString(),
      meals: meals.items,
      transactions: transactions.items,
      weighIns: weighIns.items,
      settings: normalizeSettings(data.settings),
    },
  };
}
