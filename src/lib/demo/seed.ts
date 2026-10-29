import type {
  ChatMessage,
  FoodItem,
  Meal,
  MealType,
  RecordSource,
  Transaction,
  UserSettings,
  WeighIn,
} from "@/server/compat/domain";
import { findReferenceFood } from "@/lib/demo/food-data";
import { addDaysISO, mealLabel, toISODate } from "@/lib/format";
import { round } from "@/lib/utils";

export interface SeedState {
  settings: UserSettings;
  meals: Meal[];
  transactions: Transaction[];
  weighIns: WeighIn[];
  chatMessages: ChatMessage[];
}

const SEED_SESSION = "main";

function timestampFor(date: string, hours: number, minutes: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(year, month - 1, day, hours, minutes, 0, 0).toISOString();
}

function makeFood(foodId: string, quantity: number): FoodItem {
  const reference = findReferenceFood(foodId);
  return {
    id: `seed_item_${foodId}_${quantity}`,
    name: reference.name,
    quantity: quantity === 1 ? reference.serving : `${quantity} × ${reference.serving}`,
    calories: round(reference.calories * quantity, 1),
    protein: round(reference.protein * quantity, 1),
  };
}

function makeMeal(
  id: string,
  date: string,
  mealType: MealType,
  time: [number, number],
  items: Array<[string, number]>,
  source: RecordSource = "seed",
): Meal {
  const foods = items.map(([foodId, quantity]) => makeFood(foodId, quantity));
  const title = foods.map((food) => food.name).join(" · ");
  return {
    id,
    date,
    mealType,
    title,
    items: foods,
    source,
    createdAt: timestampFor(date, time[0], time[1]),
  };
}

function makeTransaction(
  id: string,
  type: "expense" | "income",
  amount: number,
  category: string,
  description: string,
  date: string,
  time: [number, number],
): Transaction {
  return {
    id,
    type,
    amount,
    category,
    description,
    date,
    source: "seed",
    createdAt: timestampFor(date, time[0], time[1]),
  };
}

function makeWeighIn(id: string, date: string, weightKg: number, time: [number, number]): WeighIn {
  return {
    id,
    date,
    weightKg,
    source: "seed",
    createdAt: timestampFor(date, time[0], time[1]),
  };
}

/**
 * Deterministic, realistic sample workspace. Dates are relative to `today`
 * so the dashboard always looks current. Every record is replaceable.
 */
export function buildSeedState(today: string): SeedState {
  const day = (offset: number) => addDaysISO(today, offset);

  const meals: Meal[] = [
    makeMeal("seed_meal_breakfast", today, "breakfast", [8, 5], [
      ["egg", 3],
      ["banana", 2],
      ["milk", 1],
    ]),
    makeMeal("seed_meal_lunch", today, "lunch", [13, 20], [
      ["rice", 1],
      ["dal", 1],
      ["paneer", 1],
      ["roti", 2],
    ]),
    makeMeal("seed_meal_snack", today, "snack", [17, 10], [
      ["protein-shake", 1],
      ["almonds", 1],
    ]),
    makeMeal("seed_meal_y_breakfast", day(-1), "breakfast", [8, 30], [
      ["oats", 1],
      ["milk", 1],
      ["banana", 1],
    ]),
    makeMeal("seed_meal_y_lunch", day(-1), "lunch", [13, 5], [
      ["rice", 2],
      ["dal", 1],
      ["curd", 1],
    ]),
    makeMeal("seed_meal_y_dinner", day(-1), "dinner", [20, 30], [
      ["roti", 3],
      ["paneer", 1],
      ["chai", 1],
    ]),
    makeMeal("seed_meal_2_breakfast", day(-2), "breakfast", [9, 0], [
      ["idli", 3],
      ["chai", 1],
    ]),
    makeMeal("seed_meal_2_lunch", day(-2), "lunch", [13, 45], [
      ["chicken", 2],
      ["rice", 1],
      ["curd", 1],
    ]),
    makeMeal("seed_meal_2_dinner", day(-2), "dinner", [21, 0], [
      ["dosa", 2],
      ["dal", 1],
    ]),
    makeMeal("seed_meal_4_lunch", day(-4), "lunch", [12, 50], [
      ["rice", 1],
      ["rajma", 1],
      ["curd", 1],
    ]),
    makeMeal("seed_meal_6_dinner", day(-6), "dinner", [20, 15], [
      ["maggi", 1],
      ["egg", 2],
    ]),
    makeMeal("seed_meal_9_breakfast", day(-9), "breakfast", [8, 15], [
      ["poha", 1],
      ["milk", 1],
    ]),
  ];

  const transactions: Transaction[] = [
    makeTransaction("seed_tx_travel_today", "expense", 60, "Transport", "Travel to college", today, [9, 15]),
    makeTransaction("seed_tx_food_today", "expense", 80, "Food", "Canteen lunch", today, [13, 25]),
    makeTransaction("seed_tx_food_yday", "expense", 180, "Food", "Dinner with friends", day(-1), [20, 45]),
    makeTransaction("seed_tx_travel_yday", "expense", 40, "Transport", "Auto to station", day(-1), [18, 20]),
    makeTransaction("seed_tx_college", "expense", 450, "College", "Lab manual and prints", day(-2), [11, 30]),
    makeTransaction("seed_tx_recharge", "expense", 239, "Mobile recharge", "Monthly data pack", day(-3), [10, 5]),
    makeTransaction("seed_tx_entertainment", "expense", 200, "Entertainment", "Movie ticket", day(-4), [19, 0]),
    makeTransaction("seed_tx_shopping", "expense", 520, "Shopping", "Running shoes", day(-6), [16, 40]),
    makeTransaction("seed_tx_subscription", "expense", 129, "Subscriptions", "Spotify student plan", day(-8), [9, 0]),
    makeTransaction("seed_tx_college_2", "expense", 300, "College", "Xerox notes", day(-10), [15, 15]),
    makeTransaction("seed_tx_food_2", "expense", 240, "Food", "Weekly groceries", day(-12), [18, 35]),
    makeTransaction("seed_tx_travel_2", "expense", 75, "Transport", "Bus pass top-up", day(-14), [8, 45]),
    makeTransaction("seed_tx_pocket", "income", 2000, "Pocket money", "Monthly pocket money", day(-16), [12, 0]),
    makeTransaction("seed_tx_freelance", "income", 1500, "Freelance", "Poster design project", day(-20), [17, 30]),
    makeTransaction("seed_tx_food_last_month", "expense", 320, "Food", "Birthday dinner", day(-34), [20, 10]),
    makeTransaction("seed_tx_travel_last_month", "expense", 110, "Transport", "Train ticket home", day(-37), [7, 50]),
    makeTransaction("seed_tx_subscription_last_month", "expense", 129, "Subscriptions", "Spotify student plan", day(-40), [9, 0]),
    makeTransaction("seed_tx_pocket_last_month", "income", 2000, "Pocket money", "Monthly pocket money", day(-45), [12, 0]),
  ];

  const weights: Array<[number, number]> = [
    [-28, 46.8],
    [-25, 47.0],
    [-22, 46.9],
    [-19, 47.2],
    [-16, 47.4],
    [-13, 47.3],
    [-10, 47.5],
    [-7, 47.8],
    [-4, 47.9],
    [-1, 48.0],
    [0, 48.2],
  ];
  const weighIns: WeighIn[] = weights.map(([offset, weight], index) =>
    makeWeighIn(`seed_weight_${index}`, day(offset), weight, [7, 30]),
  );

  const settings: UserSettings = {
    displayName: "Aarav Sharma",
    email: "aarav@personaltracker.app",
    timezone: "Asia/Kolkata",
    calorieTarget: 2800,
    proteinTarget: 130,
    weightUnit: "kg",
    monthlyBudget: 12000,
    currency: "INR",
    theme: "system",
    aiProvider: "Built-in demo interpreter",
    aiModel: "rule-based-v1",
  };

  const chatMessages: ChatMessage[] = [
    {
      id: "seed_chat_user_1",
      sessionId: SEED_SESSION,
      role: "user",
      content: "I ate three eggs and two bananas for breakfast.",
      createdAt: timestampFor(today, 8, 2),
    },
    {
      id: "seed_chat_assistant_1",
      sessionId: SEED_SESSION,
      role: "assistant",
      content:
        "Done — I've logged breakfast for today. Estimates: 3 eggs and 2 bananas. You can open the full meal to adjust portions or remove it.",
      attachment: { kind: "meal", id: "seed_meal_breakfast" },
      createdAt: timestampFor(today, 8, 3),
    },
  ];

  return { settings, meals, transactions, weighIns, chatMessages };
}

export const DEMO_SEED_TODAY = toISODate(new Date());
export { SEED_SESSION };
export { mealLabel };
