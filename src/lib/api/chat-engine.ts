// Demo AI chat "brain". This is a lightweight, deterministic keyword/pattern
// matcher that stands in for a real LLM-backed assistant. It is intentionally
// simple and transparent so it is obvious this is a DEMO, not a model call.
//
// A production build would replace `interpretMessage` with a POST to
// `/functions/v1/ai-chat`, which would run the same kind of structured
// "intent + payload" extraction server-side using a real provider.

import type {
  ChatActionResult,
  ExpenseCategory,
  FoodItem,
  IncomeCategory,
  Meal,
  MealType,
  Transaction,
} from "@/types/domain";
import { __internal, computeDashboardSummary } from "./tracker-service";
import { generateId } from "./client";
import {
  formatCurrency,
  formatGrams,
  formatKcal,
  relativeDayLabel,
  toISODate,
} from "@/lib/formatting";

export interface ChatTurnResult {
  reply: string;
  action?: ChatActionResult;
}

interface FoodInfo {
  calories: number;
  protein: number;
  unit: string;
}

const FOOD_DB: Record<string, FoodInfo> = {
  egg: { calories: 78, protein: 6.3, unit: "boiled egg" },
  eggs: { calories: 78, protein: 6.3, unit: "boiled egg" },
  banana: { calories: 105, protein: 1.3, unit: "medium banana" },
  bananas: { calories: 105, protein: 1.3, unit: "medium banana" },
  milk: { calories: 150, protein: 8, unit: "glass (250ml)" },
  rice: { calories: 206, protein: 4.3, unit: "cup cooked" },
  roti: { calories: 80, protein: 2.5, unit: "piece" },
  chapati: { calories: 80, protein: 2.5, unit: "piece" },
  chicken: { calories: 248, protein: 46.5, unit: "150g grilled" },
  paneer: { calories: 265, protein: 18, unit: "100g" },
  apple: { calories: 95, protein: 0.5, unit: "medium apple" },
  apples: { calories: 95, protein: 0.5, unit: "medium apple" },
  bread: { calories: 80, protein: 2.7, unit: "slice" },
  curd: { calories: 98, protein: 11, unit: "cup" },
  yogurt: { calories: 150, protein: 17, unit: "cup (greek)" },
  yoghurt: { calories: 150, protein: 17, unit: "cup (greek)" },
  almonds: { calories: 70, protein: 2.5, unit: "10 pieces" },
  oats: { calories: 150, protein: 5, unit: "bowl cooked" },
  dal: { calories: 180, protein: 12, unit: "bowl" },
  potato: { calories: 110, protein: 2.5, unit: "medium" },
  tea: { calories: 40, protein: 1, unit: "cup" },
  coffee: { calories: 35, protein: 1, unit: "cup" },
  peanutbutter: { calories: 95, protein: 3.6, unit: "tbsp" },
};

const WORD_NUMBERS: Record<string, number> = {
  a: 1,
  an: 1,
  one: 1,
  two: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
  couple: 2,
  few: 3,
};

const EXPENSE_KEYWORDS: Array<{ category: ExpenseCategory; words: string[] }> = [
  { category: "Transport", words: ["travel", "travelling", "traveling", "bus", "auto", "cab", "taxi", "uber", "ola", "train", "metro", "fuel", "petrol"] },
  { category: "Food", words: ["food", "lunch", "dinner", "breakfast", "snack", "restaurant", "grocery", "groceries", "zomato", "swiggy", "canteen"] },
  { category: "Mobile recharge", words: ["recharge", "mobile", "data pack", "sim"] },
  { category: "College", words: ["college", "tuition", "fees", "stationery", "printing", "books"] },
  { category: "Shopping", words: ["shopping", "clothes", "shirt", "shoes", "amazon", "flipkart"] },
  { category: "Subscriptions", words: ["subscription", "netflix", "spotify", "prime"] },
  { category: "Entertainment", words: ["movie", "entertainment", "game", "concert", "outing"] },
];

const INCOME_KEYWORDS: Array<{ category: IncomeCategory; words: string[] }> = [
  { category: "Pocket money", words: ["pocket money", "allowance"] },
  { category: "Salary", words: ["salary", "stipend"] },
  { category: "Freelance", words: ["freelance", "gig", "project payment"] },
  { category: "Gift", words: ["gift", "birthday money"] },
];

function extractAmount(text: string): number | null {
  const match = text.match(/(?:₹|rs\.?|inr)\s?([\d,]+(?:\.\d{1,2})?)|([\d,]+(?:\.\d{1,2})?)\s?(?:rupees|rs\.?|inr|₹)/i);
  if (!match) return null;
  const raw = (match[1] ?? match[2] ?? "").replace(/,/g, "");
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : null;
}

function matchCategory<T extends string>(
  text: string,
  table: Array<{ category: T; words: string[] }>,
): T | null {
  const lower = text.toLowerCase();
  for (const entry of table) {
    if (entry.words.some((w) => lower.includes(w))) return entry.category;
  }
  return null;
}

function isYesterdayMention(text: string): boolean {
  return /yesterday/i.test(text);
}

function parseFoodItems(text: string): FoodItem[] {
  const segments = text
    .toLowerCase()
    .replace(/^i\s+(ate|had|drank|consumed)\s+/i, "")
    .split(/,|\band\b/i)
    .map((s) => s.trim())
    .filter(Boolean);

  const items: FoodItem[] = [];

  for (const segment of segments) {
    const words = segment.split(/\s+/);
    let quantity = 1;
    let matchedKey: string | null = null;

    for (const key of Object.keys(FOOD_DB)) {
      if (segment.includes(key)) {
        matchedKey = key;
        break;
      }
    }
    if (!matchedKey) continue;

    for (const word of words) {
      const cleaned = word.replace(/[^a-z0-9.]/g, "");
      if (!cleaned) continue;
      if (/^\d+(\.\d+)?$/.test(cleaned)) {
        quantity = parseFloat(cleaned);
        break;
      }
      if (WORD_NUMBERS[cleaned] !== undefined) {
        quantity = WORD_NUMBERS[cleaned];
        break;
      }
    }

    const info = FOOD_DB[matchedKey];
    const label = matchedKey.charAt(0).toUpperCase() + matchedKey.slice(1);
    items.push({
      id: generateId("fi"),
      name: label,
      quantity: `${quantity} \u00d7 ${info.unit}`,
      calories: Math.round(info.calories * quantity),
      protein: Number((info.protein * quantity).toFixed(1)),
      isEstimate: true,
    });
  }

  return items;
}

function inferMealType(): MealType {
  const hour = new Date().getHours();
  if (hour < 11) return "breakfast";
  if (hour < 16) return "lunch";
  if (hour < 19) return "snack";
  return "dinner";
}

function wantsProteinOrCalorieSummary(text: string): "protein" | "calories" | null {
  const lower = text.toLowerCase();
  if (/protein/.test(lower) && /(how much|eaten|had|so far|today)/.test(lower)) return "protein";
  if (/calor/.test(lower) && /(how much|eaten|had|so far|today)/.test(lower)) return "calories";
  return null;
}

function wantsBudgetSummary(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    /how much (money|budget|do i have)/.test(lower) ||
    /left this month/.test(lower) ||
    /review my spending/.test(lower) ||
    /spending (summary|this month)/.test(lower)
  );
}

function wantsDaySummary(text: string): boolean {
  return /summar(y|ise|ize) my day/i.test(text);
}

export function interpretMessage(rawText: string): ChatTurnResult {
  const text = rawText.trim();
  if (!text) {
    return { reply: "Tell me what you'd like to log or ask \u2014 I'm listening." };
  }

  const lower = text.toLowerCase();

  // --- Correction intent -----------------------------------------------
  if (/correct|change|update|fix/.test(lower) && /(expense|spent|spending)/.test(lower)) {
    const amount = extractAmount(text);
    const category = matchCategory(text, EXPENSE_KEYWORDS);
    if (amount === null) {
      return {
        reply:
          "I can update that expense, but I need the corrected amount \u2014 for example \u201cCorrect yesterday's travel expense to \u20b930\u201d.",
      };
    }
    const targetDate = isYesterdayMention(text)
      ? toISODate(new Date(Date.now() - 86400000))
      : toISODate(new Date());

    const updated = __internal.updateTransactionByDescriptionAndDate((t) => {
      const categoryMatches = category ? t.category === category : true;
      return t.type === "expense" && t.date === targetDate && categoryMatches;
    }, amount);

    if (!updated) {
      return {
        reply: `I couldn't find a matching ${category ?? "expense"} entry on ${relativeDayLabel(
          `${targetDate}T00:00:00`,
        ).toLowerCase()} to correct. You can edit it directly from the Budget page instead.`,
      };
    }

    return {
      reply: `Done \u2014 I've updated your ${updated.category.toLowerCase()} expense on ${relativeDayLabel(
        `${updated.date}T00:00:00`,
      )} to ${formatCurrency(updated.amount)}.`,
      action: {
        kind: "expense-logged",
        title: "Expense updated",
        mock: true,
        transaction: updated,
      },
    };
  }

  // --- Weight ------------------------------------------------------------
  const weightMatch = lower.match(/(\d{2,3}(?:\.\d{1,2})?)\s?kg/);
  if (weightMatch && /weight/.test(lower)) {
    const weightKg = parseFloat(weightMatch[1]);
    const date = toISODate(new Date());
    const weighIn = {
      id: generateId("wi"),
      weightKg,
      date,
      source: "ai" as const,
    };
    __internal.upsertTodayWeighIn(weighIn);
    return {
      reply: `Got it \u2014 I've logged today's weight as ${weightKg.toFixed(1)} kg.`,
      action: {
        kind: "weight-logged",
        title: "Weight check-in saved",
        mock: true,
        weighIn,
      },
    };
  }

  // --- Expense -------------------------------------------------------------
  const spentIntent = /\b(spent|paid|bought|spend)\b/.test(lower);
  if (spentIntent) {
    const amount = extractAmount(text);
    if (amount === null) {
      return {
        reply:
          "I think that's an expense, but I couldn't find an amount. Try something like \u201cI spent \u20b960 travelling to college\u201d.",
      };
    }
    const category = matchCategory(text, EXPENSE_KEYWORDS) ?? "Other";
    const txn: Transaction = {
      id: generateId("txn"),
      type: "expense",
      amount,
      category,
      description: text.replace(/^i\s+/i, "").slice(0, 80),
      date: isYesterdayMention(text) ? toISODate(new Date(Date.now() - 86400000)) : toISODate(new Date()),
      source: "ai",
      createdAt: new Date().toISOString(),
    };
    __internal.addTransaction(txn);
    return {
      reply: `Done! I've recorded your ${category.toLowerCase()} expense.`,
      action: {
        kind: "expense-logged",
        title: "Expense saved",
        mock: true,
        transaction: txn,
      },
    };
  }

  // --- Income --------------------------------------------------------------
  const incomeIntent = /\b(received|got|earned|credited)\b/.test(lower);
  if (incomeIntent) {
    const amount = extractAmount(text);
    if (amount === null) {
      return {
        reply:
          "That sounds like income, but I couldn't find an amount. Try something like \u201cI received \u20b92,000 pocket money\u201d.",
      };
    }
    const category = matchCategory(text, INCOME_KEYWORDS) ?? "Other";
    const txn: Transaction = {
      id: generateId("txn"),
      type: "income",
      amount,
      category,
      description: text.replace(/^i\s+/i, "").slice(0, 80),
      date: toISODate(new Date()),
      source: "ai",
      createdAt: new Date().toISOString(),
    };
    __internal.addTransaction(txn);
    return {
      reply: `Nice! I've added ${formatCurrency(amount)} as income under ${category}.`,
      action: {
        kind: "income-logged",
        title: "Income saved",
        mock: true,
        transaction: txn,
      },
    };
  }

  // --- Meal logging ----------------------------------------------------
  const mealIntent = /\b(ate|had|drank|consumed)\b/.test(lower) && !spentIntent && !incomeIntent;
  if (mealIntent) {
    const items = parseFoodItems(text);
    if (items.length === 0) {
      return {
        reply:
          "I couldn't recognise any food items in that message. Try naming foods I know, like eggs, rice, chicken, banana, milk or roti.",
      };
    }
    const totalCalories = items.reduce((a, b) => a + b.calories, 0);
    const totalProtein = Number(items.reduce((a, b) => a + b.protein, 0).toFixed(1));
    const meal: Meal = {
      id: generateId("meal"),
      type: inferMealType(),
      items,
      totalCalories,
      totalProtein,
      loggedAt: new Date().toISOString(),
      source: "ai",
    };
    __internal.addMeal(meal);
    return {
      reply: `Logged! That's an estimated ${formatKcal(totalCalories)} and ${formatGrams(
        totalProtein,
      )} of protein for ${meal.type}.`,
      action: {
        kind: "meal-logged",
        title: "Meal saved",
        mock: true,
        meal,
      },
    };
  }

  // --- Informational queries --------------------------------------------
  const nutritionQuery = wantsProteinOrCalorieSummary(text);
  if (nutritionQuery) {
    const summary = computeDashboardSummary();
    if (nutritionQuery === "protein") {
      return {
        reply: `You've had an estimated ${formatGrams(summary.proteinConsumed)} of protein today out of your ${formatGrams(
          summary.proteinTarget,
        )} target \u2014 ${formatGrams(Math.max(summary.proteinTarget - summary.proteinConsumed, 0))} remaining.`,
      };
    }
    return {
      reply: `You've eaten an estimated ${formatKcal(summary.caloriesConsumed)} today out of your ${formatKcal(
        summary.calorieTarget,
      )} target \u2014 ${formatKcal(Math.max(summary.calorieTarget - summary.caloriesConsumed, 0))} remaining.`,
    };
  }

  if (wantsBudgetSummary(text)) {
    const summary = computeDashboardSummary();
    const remaining = summary.monthlyBudget - summary.spentThisMonth;
    return {
      reply: `This month you've spent ${formatCurrency(summary.spentThisMonth)} of your ${formatCurrency(
        summary.monthlyBudget,
      )} budget, leaving ${formatCurrency(Math.max(remaining, 0))}. Your actual available balance across all records is ${formatCurrency(
        summary.availableBalance,
      )}.`,
    };
  }

  if (wantsDaySummary(text)) {
    const summary = computeDashboardSummary();
    return {
      reply: `Today so far: ~${formatKcal(summary.caloriesConsumed)} and ${formatGrams(
        summary.proteinConsumed,
      )} protein logged, and ${formatCurrency(
        summary.recentTransactions
          .filter((t) => t.date === summary.date && t.type === "expense")
          .reduce((a, b) => a + b.amount, 0),
      )} spent today. ${summary.latestWeightKg ? `Latest weight: ${summary.latestWeightKg.toFixed(1)} kg.` : ""}`,
    };
  }

  // --- Fallback ------------------------------------------------------------
  return {
    reply:
      "I'm not fully sure what you'd like me to do. I can log meals (\u201cI ate 2 eggs and a banana\u201d), expenses (\u201cI spent \u20b960 on travel\u201d), income (\u201cI received \u20b92000 pocket money\u201d), weight (\u201cMy weight is 48.2 kg\u201d), or answer questions about today's protein, calories or budget.",
    action: { kind: "unsupported", title: "Couldn't understand that", mock: true },
  };
}
