/** Domain record ⇄ Supabase row. Money is stored as integer paise; unknown nutrition stays NULL (never 0). */
import { roundMoney } from '@/tracker/lib/formatting/currency';
import type { Kind } from './entities';
import type { Meal, Transaction, UserSettings, WeighIn } from '@/tracker/types/domain';
import type { CalendarEvent, CalendarPrefs } from '@/tracker/types/calendar';

export const TABLES: Record<Kind, string> = {
  meal: 'meals',
  transaction: 'transactions',
  weighIn: 'weigh_ins',
  settings: 'user_settings',
  chatSession: 'chat_sessions',
  chatMessage: 'chat_messages',
  calendarEvent: 'calendar_events',
  calendarPrefs: 'calendar_preferences',
};

type Row = Record<string, unknown>;
interface Meta { updatedAt: string; deleted: boolean; baseRev: number }
const paise = (rupees: number): number => Math.round(rupees * 100);
const fromPaise = (p: unknown): number => roundMoney(Number(p) / 100);
const numOrNull = (v: unknown): number | null => (v === null || v === undefined ? null : Number(v));
const iso = (v: unknown): string => new Date(String(v)).toISOString();

/** The row (or RPC payload for meals) that stores `data`. Soft deletes keep the content and set `deleted_at`. */
export function toRow(kind: Kind, data: unknown, m: Meta, userId: string): Row {
  const base = { user_id: userId, updated_at: m.updatedAt, deleted_at: m.deleted ? m.updatedAt : null, base_rev: m.baseRev };
  switch (kind) {
    case 'meal': {
      const x = data as Meal;
      return {
        id: x.id, meal_type: x.mealType, eaten_at: x.eatenAt, notes: x.notes, source: x.source, updated_at: m.updatedAt,
        deleted_at: base.deleted_at, base_rev: m.baseRev,
        items: x.items.map((i) => ({ id: i.id, food_name: i.foodName, quantity: i.quantity, unit: i.unit, calories_kcal: i.caloriesKcal, protein_g: i.proteinG, is_estimate: i.isEstimate, nutrition_source: i.nutritionSource })),
      };
    }
    case 'transaction': {
      const x = data as Transaction;
      return { ...base, id: x.id, type: x.type, amount_paise: paise(x.amount), currency: 'INR', category: x.category, description: x.description, merchant: x.merchant, notes: x.notes, occurred_at: x.occurredAt, source: x.source };
    }
    case 'weighIn': {
      const x = data as WeighIn;
      return { ...base, id: x.id, weight_kg: x.weightKg, recorded_at: x.recordedAt, notes: x.notes, source: x.source };
    }
    case 'settings': {
      const x = data as UserSettings;
      return {
        ...base, id: 'settings', display_name: x.displayName, email: x.email, timezone: x.timezone, opening_balance_paise: paise(x.openingBalance),
        daily_calorie_target: x.dailyCalorieTarget, daily_protein_target_g: x.dailyProteinTargetG,
        monthly_budget_paise: x.monthlyBudget === null ? null : paise(x.monthlyBudget), target_weight_kg: x.targetWeightKg,
        weight_unit: x.weightUnit, preferred_ai_provider: x.preferredAiProvider, preferred_ai_model: x.preferredAiModel,
      };
    }
    case 'chatSession': {
      const x = data as { id: string; title: string; createdAt: string; updatedAt: string };
      return { ...base, id: x.id, title: x.title, chat_created_at: x.createdAt, chat_updated_at: x.updatedAt };
    }
    case 'chatMessage': {
      const x = data as { id: string; sessionId: string; role: string; content: string; createdAt: string; clientMessageId?: string } & Row;
      const { id, sessionId, role, content, createdAt, clientMessageId, ...extra } = x;
      return { ...base, id, session_id: sessionId, role, content, message_created_at: createdAt, client_message_id: clientMessageId ?? null, extra };
    }
    case 'calendarEvent': {
      const x = data as CalendarEvent;
      return {
        ...base, id: x.id, title: x.title, notes: x.notes, location: x.location, all_day: x.allDay, start_date: x.startDate, end_date: x.endDate,
        starts_at: x.startsAt, ends_at: x.endsAt, category: x.category, origin: x.origin, google_calendar_id: x.google?.calendarId ?? null,
        google_event_id: x.google?.eventId ?? null, google_etag: x.google?.etag ?? null, read_only: x.readOnly,
      };
    }
    case 'calendarPrefs': {
      const x = data as CalendarPrefs;
      return { ...base, id: 'prefs', week_start: x.weekStart, default_view: x.defaultView, visible: x.show, accent: x.accent };
    }
  }
}

/** Rebuilds the domain record from a row. `items` is only used for meals. */
export function fromRow(kind: Kind, r: Row, items: Row[] = []): unknown {
  switch (kind) {
    case 'meal':
      return {
        id: r.id, mealType: r.meal_type, eatenAt: iso(r.eaten_at), notes: r.notes ?? null, source: r.source,
        items: [...items].sort((a, b) => Number(a.position) - Number(b.position)).map((i) => ({
          id: i.id, foodName: i.food_name, quantity: numOrNull(i.quantity), unit: (i.unit as string | null) ?? null,
          caloriesKcal: numOrNull(i.calories_kcal), proteinG: numOrNull(i.protein_g), isEstimate: i.is_estimate === true, nutritionSource: i.nutrition_source,
        })),
      };
    case 'transaction':
      return { id: r.id, type: r.type, amount: fromPaise(r.amount_paise), currency: 'INR', category: r.category, description: r.description, merchant: r.merchant ?? null, notes: r.notes ?? null, occurredAt: iso(r.occurred_at), source: r.source };
    case 'weighIn':
      return { id: r.id, weightKg: Number(r.weight_kg), recordedAt: iso(r.recorded_at), notes: r.notes ?? null, source: r.source };
    case 'settings':
      return {
        displayName: r.display_name, email: r.email, timezone: r.timezone, currency: 'INR', openingBalance: fromPaise(r.opening_balance_paise),
        dailyCalorieTarget: numOrNull(r.daily_calorie_target), dailyProteinTargetG: numOrNull(r.daily_protein_target_g),
        monthlyBudget: r.monthly_budget_paise === null ? null : fromPaise(r.monthly_budget_paise), targetWeightKg: numOrNull(r.target_weight_kg),
        weightUnit: r.weight_unit, preferredAiProvider: r.preferred_ai_provider, preferredAiModel: r.preferred_ai_model ?? null,
      };
    case 'chatSession':
      return { id: r.id, title: r.title, createdAt: iso(r.chat_created_at), updatedAt: iso(r.chat_updated_at) };
    case 'chatMessage':
      return { ...(r.extra as Row), id: r.id, sessionId: r.session_id, role: r.role, content: r.content, createdAt: iso(r.message_created_at), ...(r.client_message_id ? { clientMessageId: r.client_message_id } : {}) };
    case 'calendarEvent':
      return {
        id: r.id, title: r.title, notes: r.notes ?? null, location: r.location ?? null, allDay: r.all_day === true,
        startDate: String(r.start_date).slice(0, 10), endDate: String(r.end_date).slice(0, 10),
        startsAt: r.starts_at ? iso(r.starts_at) : null, endsAt: r.ends_at ? iso(r.ends_at) : null, category: r.category, origin: r.origin,
        google: r.google_event_id ? { calendarId: r.google_calendar_id, eventId: r.google_event_id, etag: r.google_etag ?? null } : null, readOnly: r.read_only === true,
      };
    case 'calendarPrefs':
      return { weekStart: r.week_start, defaultView: r.default_view, show: r.visible, accent: r.accent };
  }
}
