import type {
  ActivityItem,
  CategoryTotal,
  DashboardSummary,
  TrackerSnapshot,
  Meal,
  MealType,
  MonthSummary,
  NutritionTotals,
  Transaction,
  UserSettings,
  WeighIn,
  WeightSummary,
} from "@/server/compat/domain";
import {
  formatCalories,
  formatDateHuman,
  formatGrams,
  currentMonth,
  formatWeight,
  mealLabel,
  monthKeyOf,
} from "@/lib/format";
import { round } from "@/lib/utils";

/** All finance + nutrition totals are derived from records. Nothing is hardcoded in the UI. */

export function nutritionOf(meals: Meal[]): NutritionTotals {
  return meals.reduce<NutritionTotals>(
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

export function mealsForDate(meals: Meal[], date: string): Meal[] {
  return meals.filter((meal) => meal.date === date);
}

export function nutritionForDate(meals: Meal[], date: string): NutritionTotals {
  return nutritionOf(mealsForDate(meals, date));
}

export function groupMealsByType(meals: Meal[]): Record<MealType, Meal[]> {
  return {
    breakfast: meals.filter((meal) => meal.mealType === "breakfast"),
    lunch: meals.filter((meal) => meal.mealType === "lunch"),
    dinner: meals.filter((meal) => meal.mealType === "dinner"),
    snack: meals.filter((meal) => meal.mealType === "snack"),
  };
}

export function transactionsForMonth(transactions: Transaction[], month: string): Transaction[] {
  return transactions.filter((transaction) => monthKeyOf(transaction.date) === month);
}

export function monthSummary(
  transactions: Transaction[],
  settings: UserSettings,
  month: string,
): MonthSummary {
  const monthly = transactionsForMonth(transactions, month);
  const income = monthly
    .filter((transaction) => transaction.type === "income")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const expenses = monthly
    .filter((transaction) => transaction.type === "expense")
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  const allTimeIncome = transactions
    .filter((transaction) => transaction.type === "income")
    .reduce((sum, transaction) => sum + transaction.amount, 0);
  const allTimeExpenses = transactions
    .filter((transaction) => transaction.type === "expense")
    .reduce((sum, transaction) => sum + transaction.amount, 0);

  const budget = settings.monthlyBudget;
  return {
    month,
    income: round(income, 2),
    expenses: round(expenses, 2),
    net: round(income - expenses, 2),
    budget,
    budgetRemaining: round(budget - expenses, 2),
    budgetUsedPercent: budget > 0 ? Math.round((expenses / budget) * 100) : 0,
    availableBalance: round(allTimeIncome - allTimeExpenses, 2),
    transactionCount: monthly.length,
  };
}

export function categoryBreakdown(transactions: Transaction[], month: string): CategoryTotal[] {
  const monthly = transactionsForMonth(transactions, month).filter(
    (transaction) => transaction.type === "expense",
  );
  const total = monthly.reduce((sum, transaction) => sum + transaction.amount, 0);
  const byCategory = new Map<string, number>();
  for (const transaction of monthly) {
    byCategory.set(transaction.category, (byCategory.get(transaction.category) ?? 0) + transaction.amount);
  }
  return [...byCategory.entries()]
    .map(([category, amount]) => ({
      category,
      amount: round(amount, 2),
      percent: total > 0 ? round((amount / total) * 100, 1) : 0,
    }))
    .sort((a, b) => b.amount - a.amount);
}

export function sortWeighIns(weighIns: WeighIn[]): WeighIn[] {
  return [...weighIns].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
}

export function weightSeries(weighIns: WeighIn[], limit = 24): WeighIn[] {
  return sortWeighIns(weighIns).slice(0, limit).reverse();
}

export function weightSummary(weighIns: WeighIn[]): WeightSummary {
  const sorted = sortWeighIns(weighIns);
  if (sorted.length === 0) {
    return { current: null, previous: null, delta: null, latestDate: null, first: null, totalChange: null };
  }
  const [latest, prior] = sorted;
  const first = sorted[sorted.length - 1];
  return {
    current: latest.weightKg,
    previous: prior ? prior.weightKg : null,
    delta: prior ? round(latest.weightKg - prior.weightKg, 1) : null,
    latestDate: latest.date,
    first: first.weightKg,
    totalChange: round(latest.weightKg - first.weightKg, 1),
  };
}

export function activityFeed(
  input: { meals: Meal[]; transactions: Transaction[]; weighIns: WeighIn[] },
  today: string,
  limit = 8,
): ActivityItem[] {
  const items: ActivityItem[] = [];

  for (const meal of input.meals) {
    const totals = nutritionOf([meal]);
    items.push({
      id: `meal-${meal.id}`,
      type: "meal",
      title: `${mealLabel(meal.mealType)} · ${meal.title || "Meal"}`,
      detail: `${formatCalories(totals.calories)} · ${formatGrams(totals.protein)} protein`,
      date: meal.date,
      createdAt: meal.createdAt,
      href: `/bulking?date=${meal.date}`,
    });
  }

  for (const transaction of input.transactions) {
    items.push({
      id: `tx-${transaction.id}`,
      type: transaction.type,
      title: transaction.description,
      detail: `${transaction.category} · ${formatDateHuman(transaction.date, today)}`,
      amount: transaction.type === "expense" ? -transaction.amount : transaction.amount,
      date: transaction.date,
      createdAt: transaction.createdAt,
      href: `/budget?month=${monthKeyOf(transaction.date)}&edit=${transaction.id}`,
    });
  }

  for (const weighIn of input.weighIns) {
    items.push({
      id: `weight-${weighIn.id}`,
      type: "weight",
      title: "Weight check-in",
      detail: `${formatWeight(weighIn.weightKg)} · ${formatDateHuman(weighIn.date, today)}`,
      date: weighIn.date,
      createdAt: weighIn.createdAt,
      href: "/bulking",
    });
  }

  return items
    .sort((a, b) => {
      const timeA = new Date(a.createdAt).getTime();
      const timeB = new Date(b.createdAt).getTime();
      if (timeA !== timeB) return timeB - timeA;
      return a.id.localeCompare(b.id);
    })
    .slice(0, limit);
}

export function buildDashboardSummary(snapshot: TrackerSnapshot): DashboardSummary {
  const { settings, meals, transactions, weighIns, today } = snapshot;
  const month = currentMonth(today);
  return {
    date: today,
    nutrition: nutritionForDate(meals, today),
    settings,
    month: monthSummary(transactions, settings, month),
    categories: categoryBreakdown(transactions, month),
    weight: weightSummary(weighIns),
    activity: activityFeed({ meals, transactions, weighIns }, today, 8),
  };
}
