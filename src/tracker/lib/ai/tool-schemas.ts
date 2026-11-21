import type { CanonicalToolDefinition } from './provider';

/**
 * These are provider-neutral JSON Schemas. Provider adapters may transform them to
 * satisfy vendor-specific schema restrictions, but the server must validate every
 * returned argument independently before executing a tool.
 */
const objectSchema = (properties: Record<string, unknown>, required: string[]) => ({
  type: 'object',
  properties,
  required,
  additionalProperties: false,
});

const isoDateTime = {
  type: 'string',
  description: 'ISO-8601 timestamp with timezone offset. Omit when the time is not known.',
  format: 'date-time',
};

export const AI_TOOLS: CanonicalToolDefinition[] = [
  {
    name: 'log_meal',
    description: 'Record all foods in one meal immediately. Estimate a reasonable serving and nutrition when not provided; grams and serving size are not required. Note assumptions. Omit unknown nutrition rather than guessing facts.',
    inputSchema: objectSchema({
      meal_type: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack', 'other'] },
      eaten_at: isoDateTime,
      notes: { type: 'string', maxLength: 500 },
      items: {
        type: 'array', minItems: 1, maxItems: 25,
        items: { ...objectSchema({
          food_name: { type: 'string', minLength: 1, maxLength: 200 },
          quantity: { type: 'number', exclusiveMinimum: 0, description: 'Optional amount; estimate a typical serving if unspecified.' },
          unit: { type: 'string', maxLength: 40 },
          calories_kcal: { type: 'number', minimum: 0 },
          protein_g: { type: 'number', minimum: 0 },
        }, ['food_name']) },
      },
    }, ['meal_type', 'items']),
  },
  {
    name: 'add_money_transaction',
    description: 'Record a confirmed income or expense. The amount must be explicit in the message or established by a specific clarification; never invent an amount.',
    inputSchema: objectSchema({
      transaction_type: { type: 'string', enum: ['income', 'expense'] },
      amount: { type: 'number', exclusiveMinimum: 0, maximum: 100000000 },
      currency: { type: 'string', enum: ['INR'], default: 'INR' },
      category: { type: 'string', enum: ['food', 'transport', 'mobile_recharge', 'college', 'subscriptions', 'shopping', 'health', 'entertainment', 'pocket_money', 'salary', 'gift', 'refund', 'other'] },
      description: { type: 'string', minLength: 1, maxLength: 500 },
      merchant: { type: 'string', maxLength: 200 },
      occurred_at: isoDateTime,
    }, ['transaction_type', 'amount', 'category', 'description']),
  },
  {
    name: 'log_weight',
    description: 'Record a body-weight check-in in kilograms. Ask a clarifying question if the weight or unit is unclear.',
    inputSchema: objectSchema({
      weight_kg: { type: 'number', minimum: 1, maximum: 1000 },
      recorded_at: isoDateTime,
      notes: { type: 'string', maxLength: 500 },
    }, ['weight_kg']),
  },
  {
    name: 'log_water',
    description: 'Log plain drinking water in millilitres as an intake entry. Convert litres to ml. Ask for the volume if a glass or cup size is not stated. Do not log water from other beverages.',
    inputSchema: objectSchema({
      water_ml: { type: 'number', exclusiveMinimum: 0, maximum: 100000 },
      consumed_at: isoDateTime,
    }, ['water_ml']),
  },
  {
    name: 'set_bulking_targets',
    description: 'Update only the explicit daily calorie, protein or water targets requested by the user. Each field is validated independently; the app asks for confirmation. Convert water litres to ml. Never invent targets.',
    inputSchema: objectSchema({
      calories_kcal: { type: 'number', minimum: 1, maximum: 20000 },
      protein_g: { type: 'number', minimum: 0, maximum: 1000 },
      water_ml: { type: 'number', exclusiveMinimum: 0, maximum: 100000 },
    }, []),
  },
  {
    name: 'set_water_target',
    description: 'Set the daily water target only when the user explicitly asks for a specific target in ml or litres. Never recommend or invent a target. The app requires the user to confirm the change.',
    inputSchema: objectSchema({ target_ml: { type: 'number', exclusiveMinimum: 0, maximum: 100000 } }, ['target_ml']),
  },
  {
    name: 'lookup_nutrition',
    description: 'Search offline food reference candidates and illustrative MRP estimates. Read-only, incomplete and unverified; use known serving assumptions and keep missing values unknown.',
    inputSchema: objectSchema({ query: { type: 'string', minLength: 1, maxLength: 1000 } }, ['query']),
  },
  {
    name: 'get_summary',
    description: 'Fetch authoritative totals from saved records. Use this instead of calculating totals from conversational memory.',
    inputSchema: objectSchema({
      domain: { type: 'string', enum: ['all', 'nutrition', 'finance', 'weight'] },
      period: { type: 'string', enum: ['today', 'yesterday', 'this_week', 'this_month', 'last_7_days', 'last_30_days', 'custom'] },
      start_date: { type: 'string', format: 'date', description: 'Required when period is custom.' },
      end_date: { type: 'string', format: 'date', description: 'Required when period is custom.' },
    }, ['domain', 'period']),
  },
  {
    name: 'search_entries',
    description: 'Search the signed-in user’s saved meals, transactions, or weight entries. Return only the minimum records needed to answer.',
    inputSchema: objectSchema({
      domain: { type: 'string', enum: ['meals', 'transactions', 'weight'] },
      query: { type: 'string', minLength: 1, maxLength: 200 },
      start_date: { type: 'string', format: 'date' },
      end_date: { type: 'string', format: 'date' },
      limit: { type: 'integer', minimum: 1, maximum: 10, default: 5 },
    }, ['domain', 'query']),
  },
  {
    name: 'update_transaction',
    description: 'Correct an existing transaction after identifying the exact saved record. Only fields supplied in changes will be updated.',
    inputSchema: objectSchema({
      id: { type: 'string', format: 'uuid' },
      changes: { ...objectSchema({
        transaction_type: { type: 'string', enum: ['income', 'expense'] },
        amount: { type: 'number', exclusiveMinimum: 0, maximum: 100000000 },
        category: { type: 'string', enum: ['food', 'transport', 'mobile_recharge', 'college', 'subscriptions', 'shopping', 'health', 'entertainment', 'pocket_money', 'salary', 'gift', 'refund', 'other'] },
        description: { type: 'string', minLength: 1, maxLength: 500 },
        merchant: { type: 'string', maxLength: 200 },
        occurred_at: isoDateTime,
      }, []), minProperties: 1 },
    }, ['id', 'changes']),
  },
  {
    name: 'update_meal',
    description: 'Correct the date, meal type or notes for an existing meal. Food item edits can be handled in the History UI for MVP.',
    inputSchema: objectSchema({
      id: { type: 'string', format: 'uuid' },
      changes: { ...objectSchema({
        meal_type: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack', 'other'] },
        eaten_at: isoDateTime,
        notes: { type: 'string', maxLength: 500 },
      }, []), minProperties: 1 },
    }, ['id', 'changes']),
  },
  {
    name: 'update_weight',
    description: 'Correct an existing weight entry after identifying the exact saved record.',
    inputSchema: objectSchema({
      id: { type: 'string', format: 'uuid' },
      changes: { ...objectSchema({
        weight_kg: { type: 'number', minimum: 1, maximum: 1000 },
        recorded_at: isoDateTime,
        notes: { type: 'string', maxLength: 500 },
      }, []), minProperties: 1 },
    }, ['id', 'changes']),
  },
];
