import { desc, eq } from "drizzle-orm";
import { db } from "@/db";
import { chatMessages, meals, transactions, userSettings, weighIns } from "@/db/schema";
import { buildSeedState } from "@/lib/demo/seed";
import { isValidISODate, mealLabel, todayISO } from "@/lib/format";
import { clamp, round, uid } from "@/lib/utils";
import {
  EXPENSE_CATEGORIES,
  INCOME_CATEGORIES,
  MEAL_TYPES,
  type AiStatus,
  type ChatAttachment,
  type ChatMessage,
  type FoodItem,
  type Meal,
  type MealInput,
  type MealType,
  type RecordSource,
  type TrackerSnapshot,
  type Transaction,
  type TransactionInput,
  type UserSettings,
  type UserSettingsInput,
  type WeighIn,
  type WeighInInput,
} from "@/server/compat/domain";
import type { CreatedEntity, TrackerOperation } from "@/server/compat/api";

const WORKSPACE_ID = "main";
const SOURCES: RecordSource[] = ["manual", "assistant", "seed"];

export class StoreError extends Error {
  readonly code: "validation" | "not_found" | "server";

  constructor(code: "validation" | "not_found" | "server", message: string) {
    super(message);
    this.name = "StoreError";
    this.code = code;
  }
}

const CATEGORY_SET = new Set<string>([...EXPENSE_CATEGORIES, ...INCOME_CATEGORIES, "Other"]);

export function aiStatus(): AiStatus {
  const configured = Boolean(
    process.env.AI_CHAT_ENDPOINT || process.env.AI_API_KEY || process.env.OPENAI_API_KEY,
  );
  return {
    mode: "demo",
    provider: configured ? (process.env.AI_PROVIDER ?? "Backend provider") : "Built-in demo interpreter",
    model: process.env.AI_MODEL ?? "rule-based-v1",
    configured,
    note: configured
      ? "Backend AI credentials were detected, but this build still answers with the local demo interpreter, so no provider call is claimed."
      : "No AI provider is configured. Replies are generated locally by the demo interpreter — nothing is sent to an AI provider.",
  };
}

function asSource(value: string | null): RecordSource {
  return SOURCES.includes(value as RecordSource) ? (value as RecordSource) : "manual";
}

/** Postgres returns `YYYY-MM-DD HH:mm:ss+00`; normalise to ISO for the client. */
function toTimestamp(value: string): string {
  if (!value) return new Date().toISOString();
  if (value.includes("T")) return value;
  const withT = value.replace(" ", "T");
  return /[zZ]$|[+-]\d{2}(:?\d{2})?$/.test(withT) ? withT : `${withT}Z`;
}

function toMeal(row: typeof meals.$inferSelect): Meal {
  return {
    id: row.id,
    date: row.date,
    mealType: row.mealType as MealType,
    title: row.title,
    items: row.items ?? [],
    notes: row.notes ?? undefined,
    source: asSource(row.source),
    createdAt: toTimestamp(row.createdAt),
  };
}

function toTransaction(row: typeof transactions.$inferSelect): Transaction {
  return {
    id: row.id,
    type: row.type === "income" ? "income" : "expense",
    amount: row.amount,
    category: row.category,
    description: row.description,
    date: row.date,
    notes: row.notes ?? undefined,
    source: asSource(row.source),
    createdAt: toTimestamp(row.createdAt),
  };
}

function toWeighIn(row: typeof weighIns.$inferSelect): WeighIn {
  return {
    id: row.id,
    date: row.date,
    weightKg: row.weightKg,
    notes: row.notes ?? undefined,
    source: asSource(row.source),
    createdAt: toTimestamp(row.createdAt),
  };
}

function toChatMessage(row: typeof chatMessages.$inferSelect): ChatMessage {
  return {
    id: row.id,
    sessionId: row.sessionId,
    role: row.role === "assistant" ? "assistant" : "user",
    content: row.content,
    attachment: row.attachment ?? undefined,
    createdAt: toTimestamp(row.createdAt),
  };
}

function toSettings(row: typeof userSettings.$inferSelect): UserSettings {
  return {
    displayName: row.displayName,
    email: row.email,
    timezone: row.timezone,
    calorieTarget: row.calorieTarget,
    proteinTarget: row.proteinTarget,
    weightUnit: row.weightUnit === "lb" ? "lb" : "kg",
    monthlyBudget: row.monthlyBudget,
    currency: "INR",
    theme:
      row.theme === "light" || row.theme === "dark" || row.theme === "system" ? row.theme : "system",
    aiProvider: row.aiProvider,
    aiModel: row.aiModel,
  };
}

let seeding: Promise<void> | null = null;

async function seedIfEmpty(): Promise<void> {
  const existing = await db.select({ id: userSettings.id }).from(userSettings).limit(1);
  if (existing.length > 0) return;

  const seed = buildSeedState(todayISO());
  await db.insert(userSettings).values({
    id: WORKSPACE_ID,
    displayName: seed.settings.displayName,
    email: seed.settings.email,
    timezone: seed.settings.timezone,
    calorieTarget: seed.settings.calorieTarget,
    proteinTarget: seed.settings.proteinTarget,
    weightUnit: seed.settings.weightUnit,
    monthlyBudget: seed.settings.monthlyBudget,
    currency: seed.settings.currency,
    theme: seed.settings.theme,
    aiProvider: seed.settings.aiProvider,
    aiModel: seed.settings.aiModel,
  });
  if (seed.meals.length > 0) {
    await db.insert(meals).values(
      seed.meals.map((meal) => ({
        id: meal.id,
        date: meal.date,
        mealType: meal.mealType,
        title: meal.title,
        items: meal.items,
        notes: meal.notes ?? null,
        source: meal.source,
        createdAt: meal.createdAt,
      })),
    );
  }
  if (seed.transactions.length > 0) {
    await db.insert(transactions).values(
      seed.transactions.map((transaction) => ({
        id: transaction.id,
        type: transaction.type,
        amount: transaction.amount,
        category: transaction.category,
        description: transaction.description,
        date: transaction.date,
        notes: transaction.notes ?? null,
        source: transaction.source,
        createdAt: transaction.createdAt,
      })),
    );
  }
  if (seed.weighIns.length > 0) {
    await db.insert(weighIns).values(
      seed.weighIns.map((weighIn) => ({
        id: weighIn.id,
        date: weighIn.date,
        weightKg: weighIn.weightKg,
        notes: weighIn.notes ?? null,
        source: weighIn.source,
        createdAt: weighIn.createdAt,
      })),
    );
  }
  if (seed.chatMessages.length > 0) {
    await db.insert(chatMessages).values(
      seed.chatMessages.map((message) => ({
        id: message.id,
        sessionId: message.sessionId,
        role: message.role,
        content: message.content,
        attachment: message.attachment ?? null,
        createdAt: message.createdAt,
      })),
    );
  }
}

export async function ensureSeeded(): Promise<void> {
  if (!seeding) {
    seeding = seedIfEmpty().catch((error) => {
      seeding = null;
      throw error;
    });
  }
  await seeding;
}

export async function getSnapshot(): Promise<TrackerSnapshot> {
  await ensureSeeded();
  const [settingsRows, mealRows, transactionRows, weighInRows, chatRows] = await Promise.all([
    db.select().from(userSettings).where(eq(userSettings.id, WORKSPACE_ID)).limit(1),
    db.select().from(meals).orderBy(desc(meals.date), desc(meals.createdAt)),
    db.select().from(transactions).orderBy(desc(transactions.date), desc(transactions.createdAt)),
    db.select().from(weighIns).orderBy(desc(weighIns.date)),
    db.select().from(chatMessages).orderBy(chatMessages.createdAt),
  ]);

  if (settingsRows.length === 0) throw new StoreError("server", "Workspace settings are missing.");

  const settings = toSettings(settingsRows[0]);
  return {
    storage: "database",
    today: todayISO(),
    generatedAt: new Date().toISOString(),
    ai: aiStatus(),
    settings,
    meals: mealRows.map(toMeal),
    transactions: transactionRows.map(toTransaction),
    weighIns: weighInRows.map(toWeighIn),
    chatMessages: chatRows.map(toChatMessage),
  };
}

/** Demo snapshot used when the database is unreachable (e.g. static preview). */
export function getDemoSnapshot(today = todayISO()): TrackerSnapshot {
  const seed = buildSeedState(today);
  return {
    storage: "demo",
    today,
    generatedAt: new Date().toISOString(),
    ai: aiStatus(),
    settings: seed.settings,
    meals: seed.meals,
    transactions: seed.transactions,
    weighIns: seed.weighIns,
    chatMessages: seed.chatMessages,
  };
}

export async function getSnapshotSafe(): Promise<TrackerSnapshot> {
  try {
    return await getSnapshot();
  } catch (error) {
    console.warn("[tracker] Falling back to demo workspace:", error);
    return getDemoSnapshot();
  }
}

/* Validation --------------------------------------------------------------- */

function validateMeal(input: MealInput): void {
  if (!isValidISODate(input.date)) throw new StoreError("validation", "Choose a valid date.");
  if (!MEAL_TYPES.includes(input.mealType)) throw new StoreError("validation", "Choose a meal type.");
  if (!Array.isArray(input.items) || input.items.length === 0) {
    throw new StoreError("validation", "Add at least one food item.");
  }
  for (const item of input.items) {
    if (!item.name || !item.name.trim()) throw new StoreError("validation", "Name every food item.");
    if (!Number.isFinite(item.calories) || item.calories < 0 || item.calories > 10000) {
      throw new StoreError("validation", "Calories must be between 0 and 10,000.");
    }
    if (!Number.isFinite(item.protein) || item.protein < 0 || item.protein > 500) {
      throw new StoreError("validation", "Protein must be between 0 and 500 g.");
    }
  }
}

function validateTransaction(input: TransactionInput): void {
  if (input.type !== "income" && input.type !== "expense") {
    throw new StoreError("validation", "Choose income or expense.");
  }
  if (!Number.isFinite(input.amount) || input.amount <= 0 || input.amount > 10000000) {
    throw new StoreError("validation", "Enter an amount between ₹1 and ₹1,00,00,000.");
  }
  if (!isValidISODate(input.date)) throw new StoreError("validation", "Choose a valid date.");
  if (!input.description || !input.description.trim()) {
    throw new StoreError("validation", "Add a short description.");
  }
}

function validateWeighIn(input: WeighInInput): void {
  if (!isValidISODate(input.date)) throw new StoreError("validation", "Choose a valid date.");
  if (!Number.isFinite(input.weightKg) || input.weightKg < 25 || input.weightKg > 250) {
    throw new StoreError("validation", "Enter a weight between 25 and 250 kg.");
  }
}

function normalizeItems(items: MealInput["items"]): FoodItem[] {
  return items.map((item) => ({
    id: uid("item"),
    name: item.name.trim().slice(0, 80),
    quantity: (item.quantity || "1 serving").trim().slice(0, 60),
    calories: round(clamp(item.calories, 0, 10000), 1),
    protein: round(clamp(item.protein, 0, 500), 1),
    isEstimate: item.isEstimate ?? true,
  }));
}

function mealTitle(title: string | undefined, items: FoodItem[]): string {
  const explicit = title?.trim();
  if (explicit) return explicit.slice(0, 80);
  const joined = items.map((item) => item.name).join(" · ");
  return joined.slice(0, 80) || mealLabel(MEAL_TYPES[0]);
}

function safeCategory(type: "income" | "expense", category: string): string {
  const value = category.trim();
  if (CATEGORY_SET.has(value)) return value;
  return type === "income" ? "Other" : "Other";
}

/* Mutations ---------------------------------------------------------------- */

export async function applyOperation(
  operation: TrackerOperation,
): Promise<{ snapshot: TrackerSnapshot; created: CreatedEntity | null }> {
  await ensureSeeded();
  let created: CreatedEntity | null = null;

  switch (operation.op) {
    case "createMeal": {
      validateMeal(operation.input);
      const items = normalizeItems(operation.input.items);
      const [row] = await db
        .insert(meals)
        .values({
          id: uid("meal"),
          date: operation.input.date,
          mealType: operation.input.mealType,
          title: mealTitle(operation.input.title, items),
          items,
          notes: operation.input.notes?.trim() || null,
          source: operation.input.source ?? "manual",
        })
        .returning();
      created = { kind: "meal", record: toMeal(row) };
      break;
    }
    case "updateMeal": {
      validateMeal(operation.input);
      const items = normalizeItems(operation.input.items);
      const [row] = await db
        .update(meals)
        .set({
          date: operation.input.date,
          mealType: operation.input.mealType,
          title: mealTitle(operation.input.title, items),
          items,
          notes: operation.input.notes?.trim() || null,
        })
        .where(eq(meals.id, operation.id))
        .returning();
      if (!row) throw new StoreError("not_found", "That meal is no longer available.");
      created = { kind: "meal", record: toMeal(row) };
      break;
    }
    case "deleteMeal": {
      const [row] = await db.delete(meals).where(eq(meals.id, operation.id)).returning();
      if (!row) throw new StoreError("not_found", "That meal is no longer available.");
      break;
    }
    case "createTransaction": {
      validateTransaction(operation.input);
      const [row] = await db
        .insert(transactions)
        .values({
          id: uid("tx"),
          type: operation.input.type,
          amount: round(operation.input.amount, 2),
          category: safeCategory(operation.input.type, operation.input.category),
          description: operation.input.description.trim().slice(0, 120),
          date: operation.input.date,
          notes: operation.input.notes?.trim() || null,
          source: operation.input.source ?? "manual",
        })
        .returning();
      created = { kind: "transaction", record: toTransaction(row) };
      break;
    }
    case "updateTransaction": {
      validateTransaction(operation.input);
      const [row] = await db
        .update(transactions)
        .set({
          type: operation.input.type,
          amount: round(operation.input.amount, 2),
          category: safeCategory(operation.input.type, operation.input.category),
          description: operation.input.description.trim().slice(0, 120),
          date: operation.input.date,
          notes: operation.input.notes?.trim() || null,
        })
        .where(eq(transactions.id, operation.id))
        .returning();
      if (!row) throw new StoreError("not_found", "That transaction is no longer available.");
      created = { kind: "transaction", record: toTransaction(row) };
      break;
    }
    case "deleteTransaction": {
      const [row] = await db
        .delete(transactions)
        .where(eq(transactions.id, operation.id))
        .returning();
      if (!row) throw new StoreError("not_found", "That transaction is no longer available.");
      break;
    }
    case "saveWeighIn": {
      validateWeighIn(operation.input);
      const existing = await db
        .select()
        .from(weighIns)
        .where(eq(weighIns.date, operation.input.date))
        .limit(1);
      if (existing.length > 0) {
        const [row] = await db
          .update(weighIns)
          .set({
            weightKg: round(operation.input.weightKg, 1),
            notes: operation.input.notes?.trim() || existing[0].notes,
          })
          .where(eq(weighIns.id, existing[0].id))
          .returning();
        created = { kind: "weighIn", record: toWeighIn(row) };
      } else {
        const [row] = await db
          .insert(weighIns)
          .values({
            id: uid("weight"),
            date: operation.input.date,
            weightKg: round(operation.input.weightKg, 1),
            notes: operation.input.notes?.trim() || null,
            source: operation.input.source ?? "manual",
          })
          .returning();
        created = { kind: "weighIn", record: toWeighIn(row) };
      }
      break;
    }
    case "deleteWeighIn": {
      const [row] = await db
        .delete(weighIns)
        .where(eq(weighIns.id, operation.id))
        .returning();
      if (!row) throw new StoreError("not_found", "That check-in is no longer available.");
      break;
    }
    case "updateSettings": {
      const input: UserSettingsInput = operation.input;
      const patch: Partial<typeof userSettings.$inferInsert> = {};
      if (input.displayName !== undefined) {
        const name = input.displayName.trim();
        if (name.length < 1) throw new StoreError("validation", "Display name cannot be empty.");
        patch.displayName = name.slice(0, 60);
      }
      if (input.email !== undefined) {
        const email = input.email.trim();
        if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new StoreError("validation", "Enter a valid email address.");
        }
        patch.email = email.slice(0, 120);
      }
      if (input.timezone !== undefined) patch.timezone = input.timezone.slice(0, 60);
      if (input.calorieTarget !== undefined) {
        if (!Number.isFinite(input.calorieTarget) || input.calorieTarget < 0 || input.calorieTarget > 10000) {
          throw new StoreError("validation", "Calorie target must be between 0 and 10,000.");
        }
        patch.calorieTarget = Math.round(input.calorieTarget);
      }
      if (input.proteinTarget !== undefined) {
        if (!Number.isFinite(input.proteinTarget) || input.proteinTarget < 0 || input.proteinTarget > 1000) {
          throw new StoreError("validation", "Protein target must be between 0 and 1,000 g.");
        }
        patch.proteinTarget = Math.round(input.proteinTarget);
      }
      if (input.weightUnit !== undefined) patch.weightUnit = input.weightUnit;
      if (input.monthlyBudget !== undefined) {
        if (!Number.isFinite(input.monthlyBudget) || input.monthlyBudget < 0 || input.monthlyBudget > 100000000) {
          throw new StoreError("validation", "Monthly budget must be a positive amount.");
        }
        patch.monthlyBudget = round(input.monthlyBudget, 2);
      }
      if (input.currency !== undefined) patch.currency = input.currency;
      if (input.theme !== undefined) patch.theme = input.theme;
      if (Object.keys(patch).length > 0) {
        await db.update(userSettings).set(patch).where(eq(userSettings.id, WORKSPACE_ID));
      }
      break;
    }
    case "clearChat": {
      await db.delete(chatMessages).where(eq(chatMessages.sessionId, operation.sessionId));
      break;
    }
    case "resetDemoData": {
      await db.delete(meals);
      await db.delete(transactions);
      await db.delete(weighIns);
      await db.delete(chatMessages);
      await db.delete(userSettings);
      seeding = null;
      await ensureSeeded();
      break;
    }
    default: {
      throw new StoreError("validation", "Unknown operation.");
    }
  }

  return { snapshot: await getSnapshot(), created };
}

export async function appendChatMessage(input: {
  sessionId: string;
  role: "user" | "assistant";
  content: string;
  attachment?: ChatAttachment | null;
}): Promise<ChatMessage> {
  const [row] = await db
    .insert(chatMessages)
    .values({
      id: uid("chat"),
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      attachment: input.attachment ?? null,
    })
    .returning();
  return toChatMessage(row);
}
