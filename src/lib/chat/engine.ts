import type {
  Meal,
  MealInput,
  MealType,
  Transaction,
  TransactionInput,
  UserSettings,
  WeighIn,
  WeighInInput,
} from "@/server/compat/domain";
import { CATEGORY_KEYWORDS, INCOME_KEYWORDS, REFERENCE_FOODS } from "@/lib/demo/food-data";
import {
  addDaysISO,
  formatDateHuman,
  formatGrams,
  formatINR,
  formatWeight,
  monthKeyOf,
} from "@/lib/format";
import { round } from "@/lib/utils";

export interface EngineState {
  settings: UserSettings;
  meals: Meal[];
  transactions: Transaction[];
  weighIns: WeighIn[];
}

export type DemoIntent =
  | { kind: "meal"; input: MealInput }
  | { kind: "transaction"; input: TransactionInput }
  | { kind: "transactionUpdate"; transactionId: string; input: TransactionInput }
  | { kind: "weighIn"; input: WeighInInput };

export interface DemoOutcome {
  reply: string;
  intent?: DemoIntent;
}

const NUMBER_WORDS: Record<string, number> = {
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
  half: 0.5,
  couple: 2,
};

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalize(message: string): string {
  return message
    .toLowerCase()
    .replace(/[₹]/g, " ₹ ")
    .replace(/[^\w₹.,'\-?\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function toSentence(value: string): string {
  const cleaned = value.trim().replace(/^[,.\s]+|[,.\s]+$/g, "");
  return cleaned ? capitalize(cleaned) : "";
}

/* Food parsing ------------------------------------------------------------ */

function findQuantity(segment: string, alias: string): number {
  const index = segment.indexOf(alias);
  const prefix = index >= 0 ? segment.slice(Math.max(0, index - 24), index) : "";
  const numeric = prefix.match(/(\d+(?:\.\d+)?)\s*(?:x|×)?\s*$/);
  if (numeric) {
    const parsed = Number.parseFloat(numeric[1]);
    if (Number.isFinite(parsed) && parsed > 0) return Math.min(parsed, 10);
  }
  const words = prefix.trim().split(/\s+/);
  const lastWord = words[words.length - 1] ?? "";
  if (NUMBER_WORDS[lastWord] !== undefined) return NUMBER_WORDS[lastWord];
  if (/(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/.test(prefix)) {
    const grams = Number.parseFloat(prefix.match(/(\d+(?:\.\d+)?)\s*g(?:rams?)?\b/)?.[1] ?? "0");
    if (grams > 0) return Math.min(Math.max(round(grams / 100, 2), 0.5), 10);
  }
  return 1;
}

export function parseFoodItems(message: string): MealInput["items"] {
  const normalized = normalize(message).replace(
    /\b(i|we|today|yesterday|just|also|then|please|my|for|had|have|ate|eat|drank|drink|consumed|took|some|of)\b/g,
    " ",
  );
  const segments = normalized
    .split(/,| and | plus | with | along with | & |;/g)
    .map((segment) => segment.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const items: MealInput["items"] = [];
  const seen = new Set<string>();

  for (const segment of segments) {
    for (const food of REFERENCE_FOODS) {
      const alias = [...food.aliases].sort((a, b) => b.length - a.length).find((candidate) =>
        new RegExp(`\\b${escapeRegExp(candidate)}\\b`).test(segment),
      );
      if (!alias || seen.has(food.id)) continue;
      const quantity = findQuantity(segment, alias);
      seen.add(food.id);
      items.push({
        name: food.name,
        quantity: quantity === 1 ? food.serving : `${round(quantity, 2)} × ${food.serving}`,
        calories: round(food.calories * quantity, 1),
        protein: round(food.protein * quantity, 1),
      });
    }
  }

  return items;
}

function mealTypeFromMessage(message: string, hour: number): MealType {
  if (/\bbreakfast\b/.test(message)) return "breakfast";
  if (/\blunch\b/.test(message)) return "lunch";
  if (/\bdinner\b/.test(message)) return "dinner";
  if (/\bsnack|evening\b/.test(message)) return "snack";
  if (hour < 11) return "breakfast";
  if (hour < 16) return "lunch";
  if (hour < 21) return "dinner";
  return "snack";
}

/* Money parsing ---------------------------------------------------------- */

export function parseAmount(message: string): number | null {
  const text = message.replace(/(\d),(\d)/g, "$1$2");
  const patterns = [
    /(?:₹|rs\.?|inr)\s*(\d+(?:\.\d+)?)/i,
    /(\d+(?:\.\d+)?)\s*(?:rupees|rs\b|inr\b|₹)/i,
    /(?:spent|paid|cost|costs|received|got|earned|credited|added|gave|sent|bought)\b[^\d]{0,16}(\d+(?:\.\d+)?)/i,
    /(?:^|\s)(\d+(?:\.\d+)?)(?:\s|$)/,
  ];
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const amount = Number.parseFloat(match[1]);
      if (Number.isFinite(amount) && amount > 0 && amount <= 10000000) return round(amount, 2);
    }
  }
  return null;
}

function detectMoneyType(message: string): "income" | "expense" | null {
  const income = /\b(received|receive|got|get|earned|earn|credited|income|salary|stipend|allowance|refund|pocket money)\b/.test(
    message,
  );
  const expense = /\b(spent|spend|paid|pay|bought|buy|cost|costs|ordered|recharge|fare|bill|gave|sent)\b/.test(
    message,
  );
  if (income && !expense) return "income";
  if (expense && !income) return "expense";
  return null;
}

function categorize(message: string, type: "income" | "expense"): string {
  const dictionary = type === "income" ? INCOME_KEYWORDS : CATEGORY_KEYWORDS;
  for (const [category, keywords] of Object.entries(dictionary)) {
    if (keywords.some((keyword) => message.includes(keyword))) return category;
  }
  return "Other";
}

function buildDescription(message: string, category: string, type: "income" | "expense"): string {
  const cleaned = message
    .replace(/(?:₹|rs\.?|inr)\s*\d[\d,]*(?:\.\d+)?/gi, " ")
    .replace(/\d[\d,]*(?:\.\d+)?\s*(?:rupees|rs|inr)\b/gi, " ")
    .replace(
      /\b(i|we|just|today|yesterday|have|had|spent|spend|paid|pay|bought|buy|received|receive|got|get|earned|cost|costs|please|record|log|add|my|a|an|the|of)\b/gi,
      " ",
    )
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^(?:on|at|for|to|in|from)\s+/i, "");
  const description = toSentence(cleaned);
  if (description.length >= 3) return description.slice(0, 60);
  return `${category} ${type === "income" ? "received" : "expense"}`;
}

function extractDate(message: string, today: string): string {
  if (/\bday before yesterday\b/.test(message)) return addDaysISO(today, -2);
  if (/\byesterday\b/.test(message)) return addDaysISO(today, -1);
  return today;
}

/* Query answers ---------------------------------------------------------- */

function nutritionTotals(meals: Meal[]) {
  return meals.reduce(
    (totals, meal) => {
      for (const item of meal.items) {
        totals.calories += item.calories;
        totals.protein += item.protein;
      }
      return totals;
    },
    { calories: 0, protein: 0 },
  );
}

function answerNutrition(state: EngineState, date: string, label: string): string {
  const meals = state.meals.filter((meal) => meal.date === date);
  const totals = nutritionTotals(meals);
  const { calorieTarget, proteinTarget } = state.settings;
  const lines = [
    `Estimated intake ${label}: ${Math.round(totals.calories)} kcal and ${formatGrams(totals.protein)} protein from ${meals.length} meal${meals.length === 1 ? "" : "s"}.`,
  ];
  if (calorieTarget > 0) {
    const remaining = calorieTarget - totals.calories;
    lines.push(
      `${remaining >= 0 ? `${Math.round(remaining)} kcal left` : `${Math.round(Math.abs(remaining))} kcal over`} of your ${calorieTarget} kcal target.`,
    );
  }
  if (proteinTarget > 0) {
    const remaining = proteinTarget - totals.protein;
    lines.push(
      `${remaining >= 0 ? `${formatGrams(remaining)} protein left` : `${formatGrams(Math.abs(remaining))} protein over`} of your ${proteinTarget} g target.`,
    );
  }
  if (calorieTarget <= 0 || proteinTarget <= 0) {
    lines.push("Set your targets in Settings to see remaining amounts.");
  }
  lines.push("Nutrition values are estimates, not measured values.");
  return lines.join(" ");
}

function answerMoney(state: EngineState, month: string): string {
  const monthly = state.transactions.filter((transaction) => monthKeyOf(transaction.date) === month);
  const expenses = monthly
    .filter((transaction) => transaction.type === "expense")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const income = monthly
    .filter((transaction) => transaction.type === "income")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const allIncome = state.transactions
    .filter((transaction) => transaction.type === "income")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const allExpenses = state.transactions
    .filter((transaction) => transaction.type === "expense")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const budget = state.settings.monthlyBudget;
  const remaining = budget - expenses;

  if (budget <= 0) {
    return `You haven't set a monthly budget yet, so I can't calculate what's left. This month you've spent ${formatINR(expenses)} and received ${formatINR(income)}. Add a monthly budget in Settings.`;
  }

  return `You have ${formatINR(Math.max(remaining, 0))} left of your ${formatINR(budget)} budget this month. So far: ${formatINR(expenses)} spent and ${formatINR(income)} received. Your recorded available balance is ${formatINR(allIncome - allExpenses)}.${remaining < 0 ? " You are over budget — worth reviewing the categories." : ""}`;
}

function answerSpendingReview(state: EngineState, month: string): string {
  const expenses = state.transactions.filter(
    (transaction) => transaction.type === "expense" && monthKeyOf(transaction.date) === month,
  );
  if (expenses.length === 0) {
    return "There are no expenses recorded this month yet. Tell me something like “I spent ₹60 on travel” and I'll add it.";
  }
  const totals = new Map<string, number>();
  for (const transaction of expenses) {
    totals.set(transaction.category, (totals.get(transaction.category) ?? 0) + transaction.amount);
  }
  const sorted = [...totals.entries()].sort((a, b) => b[1] - a[1]);
  const total = expenses.reduce((sum, transaction) => sum + transaction.amount, 0);
  const top = sorted
    .slice(0, 3)
    .map(([category, amount]) => `${category} ${formatINR(amount)} (${Math.round((amount / total) * 100)}%)`)
    .join(", ");
  const largest = [...expenses].sort((a, b) => b.amount - a.amount)[0];
  return `This month you've spent ${formatINR(total)} across ${expenses.length} entries. Biggest categories: ${top}. Largest single expense: ${largest.description} at ${formatINR(largest.amount)}. Budget remaining: ${formatINR(state.settings.monthlyBudget - total)}.`;
}

function answerDaySummary(state: EngineState, today: string): string {
  const nutrition = answerNutrition(state, today, "today");
  const spentToday = state.transactions
    .filter((transaction) => transaction.date === today && transaction.type === "expense")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const earnedToday = state.transactions
    .filter((transaction) => transaction.date === today && transaction.type === "income")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const latestWeight = [...state.weighIns].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  const weightLine = latestWeight
    ? `Latest weight: ${formatWeight(latestWeight.weightKg)} on ${formatDateHuman(latestWeight.date, today)}.`
    : "No weight check-in recorded yet.";
  return `${nutrition} Today's recorded spending is ${formatINR(spentToday)}, with ${formatINR(earnedToday)} received. ${weightLine}`;
}

/* Corrections ------------------------------------------------------------ */

function findCorrectionTarget(
  message: string,
  state: EngineState,
  date: string | null,
): Transaction | null {
  const candidates = state.transactions
    .filter((transaction) => transaction.type === "expense")
    .filter((transaction) => (date ? transaction.date === date : true))
    .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  if (candidates.length === 0) return null;
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((keyword) => message.includes(keyword))) {
      const match = candidates.find((transaction) => transaction.category === category);
      if (match) return match;
    }
  }
  return candidates[0];
}

/* Main entry ------------------------------------------------------------- */

export function interpretMessage(
  rawMessage: string,
  state: EngineState,
  today: string,
  now: Date = new Date(),
): DemoOutcome {
  const message = normalize(rawMessage);
  const question =
    rawMessage.includes("?") ||
    /\b(how much|how many|what|whats|what's|show|tell|summar|review|give|left|remaining|balance|status)\b/.test(message);

  if (!message) {
    return { reply: "I didn't catch that. Tell me what you ate, spent, received or weigh — or ask about your totals." };
  }

  /* Weight check-in */
  const weightMatch =
    message.match(/\b(\d{1,3}(?:\.\d+)?)\s*(kg|kgs|kilo|kilos|lb|lbs)\b/) ??
    message.match(/\bweight\b[^\d]{0,12}(\d{1,3}(?:\.\d+)?)/);
  if (weightMatch && !question) {
    const raw = Number.parseFloat(weightMatch[1]);
    const unit = weightMatch[2] ?? "kg";
    const kg = unit.startsWith("lb") ? round(raw / 2.20462, 1) : raw;
    if (kg >= 25 && kg <= 250) {
      return {
        intent: {
          kind: "weighIn",
          input: { date: extractDate(message, today), weightKg: round(kg, 1), source: "assistant" },
        },
        reply: `Recorded a weight check-in of ${formatWeight(kg)} for ${formatDateHuman(extractDate(message, today), today)}. One reading is noisy — the trend chart is the useful signal.`,
      };
    }
    return {
      reply: "That weight looks unusual for a person. Send something like “My weight is 48.2 kg today” if you'd like me to record it.",
    };
  }

  /* Corrections */
  if (/\b(correct|fix|change|update|should be|instead|wrong)\b/.test(message)) {
    const amount = parseAmount(rawMessage);
    if (amount) {
      const date = /\byesterday\b/.test(message)
        ? addDaysISO(today, -1)
        : /\btoday\b/.test(message)
          ? today
          : null;
      const target = findCorrectionTarget(message, state, date);
      if (target) {
        return {
          intent: {
            kind: "transactionUpdate",
            transactionId: target.id,
            input: {
              type: target.type,
              amount,
              category: target.category,
              description: target.description,
              date: target.date,
              notes: [target.notes, "Corrected via assistant"].filter(Boolean).join(" · "),
              source: target.source,
            },
          },
          reply: `Updated “${target.description}” (${target.category}, ${formatDateHuman(target.date, today)}) from ${formatINR(target.amount)} to ${formatINR(amount)}.`,
        };
      }
      return {
        reply: `I couldn't find a matching expense ${date ? `on ${formatDateHuman(date, today)}` : "recently"} to correct. Tell me the category and date, for example “Correct yesterday's travel expense to ₹30”.`,
      };
    }
    return { reply: "Tell me the corrected amount too, for example “Correct yesterday's travel expense to ₹30”." };
  }

  /* Money logging */
  const amount = parseAmount(rawMessage);
  const moneyType = detectMoneyType(message);
  if (amount !== null && moneyType) {
    const category = categorize(message, moneyType);
    const date = extractDate(message, today);
    return {
      intent: {
        kind: "transaction",
        input: {
          type: moneyType,
          amount,
          category,
          description: buildDescription(rawMessage, category, moneyType),
          date,
          source: "assistant",
        },
      },
      reply:
        moneyType === "expense"
          ? `Done — I've recorded a ${formatINR(amount)} expense under ${category} for ${formatDateHuman(date, today)}. The details are below and your budget totals are updated.`
          : `Done — I've recorded ${formatINR(amount)} of income under ${category} for ${formatDateHuman(date, today)}. Your available balance is updated.`,
    };
  }

  /* Food logging */
  const foodIntent = /\b(ate|eat|eaten|had|drank|drink|consumed|meal|breakfast|lunch|dinner|snack|food|protein shake)\b/.test(
    message,
  );
  if (foodIntent && !question) {
    const items = parseFoodItems(rawMessage);
    if (items.length > 0) {
      const date = extractDate(message, today);
      const mealType = mealTypeFromMessage(message, now.getHours());
      const calories = items.reduce((sum, item) => sum + item.calories, 0);
      const protein = items.reduce((sum, item) => sum + item.protein, 0);
      return {
        intent: {
          kind: "meal",
          input: { date, mealType, items, source: "assistant" },
        },
        reply: `Saved your ${mealType} for ${formatDateHuman(date, today)}. Estimated ${Math.round(calories)} kcal and ${formatGrams(protein)} protein — these are approximate values, so adjust portions if needed.`,
      };
    }
    return {
      reply:
        "I can log simple foods I recognise (eggs, bananas, milk, oats, rice, dal, chapati, paneer, chicken, curd, maggi and a few more), but I don't want to invent nutrition values for this one. Try naming the foods and portions, or add it manually on the Bulking page.",
    };
  }

  /* Questions */
  if (/\bprotein\b/.test(message)) {
    const date = /\byesterday\b/.test(message) ? addDaysISO(today, -1) : today;
    return { reply: answerNutrition(state, date, formatDateHuman(date, today).toLowerCase()) };
  }
  if (/\b(calorie|calories|kcal|eaten|macros?|nutrition)\b/.test(message)) {
    const date = /\byesterday\b/.test(message) ? addDaysISO(today, -1) : today;
    return { reply: answerNutrition(state, date, formatDateHuman(date, today).toLowerCase()) };
  }
  if (/\b(spend|spending|spent|review|budget|categor)\b/.test(message) && question) {
    return { reply: answerSpendingReview(state, monthKeyOf(today)) };
  }
  if (/\b(money|balance|left|remaining|income|salary|rupees|₹)\b/.test(message)) {
    return { reply: answerMoney(state, monthKeyOf(today)) };
  }
  if (/\b(summary|summarise|summarize|day|today|progress)\b/.test(message)) {
    return { reply: answerDaySummary(state, today) };
  }

  if (/\b(hi|hey|hello|yo|help|what can you do|capabilit)\b/.test(message)) {
    return {
      reply:
        "I'm your tracker assistant in demo mode. I can log food and meals, record expenses and income, take weight check-ins, correct a recent expense, and answer questions about your nutrition, budget and balance. Try: “I ate three eggs and two bananas”, “I spent ₹60 travelling to college”, “My weight is 48.2 kg today” or “How much money do I have left this month?”. Anything I can't parse safely, I'll ask about instead of guessing.",
    };
  }

  return {
    reply:
      "I'm not sure how to record that yet. I can handle food, expenses, income, weight check-ins and questions about your totals. For example: “I ate 2 eggs and a bowl of dal” or “I spent ₹60 travelling to college”. You can also add records manually from the Bulking and Budget pages.",
  };
}

export function summarizeIntent(intent: DemoIntent | undefined): string | null {
  if (!intent) return null;
  if (intent.kind === "meal") return `Saved ${intent.input.mealType} meal`;
  if (intent.kind === "transaction") return `Saved ${intent.input.type}`;
  if (intent.kind === "transactionUpdate") return "Updated expense";
  return "Saved weight check-in";
}
