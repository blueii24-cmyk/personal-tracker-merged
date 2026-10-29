import { date, integer, jsonb, pgTable, real, text, timestamp, uniqueIndex } from "drizzle-orm/pg-core";
import type { ChatAttachment, FoodItem } from "@/server/compat/domain";

export const userSettings = pgTable("user_settings", {
  id: text("id").primaryKey(),
  displayName: text("display_name").notNull(),
  email: text("email").notNull(),
  timezone: text("timezone").notNull().default("Asia/Kolkata"),
  calorieTarget: integer("calorie_target").notNull().default(0),
  proteinTarget: integer("protein_target").notNull().default(0),
  weightUnit: text("weight_unit").notNull().default("kg"),
  monthlyBudget: real("monthly_budget").notNull().default(0),
  currency: text("currency").notNull().default("INR"),
  theme: text("theme").notNull().default("system"),
  aiProvider: text("ai_provider").notNull().default("Built-in demo interpreter"),
  aiModel: text("ai_model").notNull().default("rule-based-v1"),
});

export const meals = pgTable("meals", {
  id: text("id").primaryKey(),
  date: date("date", { mode: "string" }).notNull(),
  mealType: text("meal_type").notNull(),
  title: text("title").notNull(),
  items: jsonb("items").$type<FoodItem[]>().notNull(),
  notes: text("notes"),
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const transactions = pgTable("transactions", {
  id: text("id").primaryKey(),
  type: text("type").notNull(),
  amount: real("amount").notNull(),
  category: text("category").notNull(),
  description: text("description").notNull(),
  date: date("date", { mode: "string" }).notNull(),
  notes: text("notes"),
  source: text("source").notNull().default("manual"),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});

export const weighIns = pgTable(
  "weigh_ins",
  {
    id: text("id").primaryKey(),
    date: date("date", { mode: "string" }).notNull(),
    weightKg: real("weight_kg").notNull(),
    notes: text("notes"),
    source: text("source").notNull().default("manual"),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "string" })
      .notNull()
      .defaultNow(),
  },
  (table) => [uniqueIndex("weigh_ins_date_unique").on(table.date)],
);

export const chatMessages = pgTable("chat_messages", {
  id: text("id").primaryKey(),
  sessionId: text("session_id").notNull().default("main"),
  role: text("role").notNull(),
  content: text("content").notNull(),
  attachment: jsonb("attachment").$type<ChatAttachment | null>(),
  createdAt: timestamp("created_at", { withTimezone: true, mode: "string" }).notNull().defaultNow(),
});
