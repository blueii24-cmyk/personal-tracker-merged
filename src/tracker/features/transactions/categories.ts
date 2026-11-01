import {
  Clapperboard,
  CircleEllipsis,
  Gift,
  GraduationCap,
  HeartPulse,
  Landmark,
  RotateCcw,
  Repeat,
  ShoppingBag,
  Smartphone,
  Bus,
  Utensils,
  Wallet,
  type LucideIcon,
} from 'lucide-react';
import type { ExpenseCategory, IncomeCategory, TransactionCategory, TransactionType } from '@/tracker/types/domain';
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from '@/tracker/types/domain';

interface CategoryMeta {
  label: string;
  icon: LucideIcon;
}

export const CATEGORY_META: Record<TransactionCategory, CategoryMeta> = {
  food: { label: 'Food', icon: Utensils },
  transport: { label: 'Transport', icon: Bus },
  mobile_recharge: { label: 'Mobile recharge', icon: Smartphone },
  college: { label: 'College', icon: GraduationCap },
  shopping: { label: 'Shopping', icon: ShoppingBag },
  subscriptions: { label: 'Subscriptions', icon: Repeat },
  entertainment: { label: 'Entertainment', icon: Clapperboard },
  health: { label: 'Health', icon: HeartPulse },
  pocket_money: { label: 'Pocket money', icon: Wallet },
  salary: { label: 'Salary', icon: Landmark },
  gift: { label: 'Gift', icon: Gift },
  refund: { label: 'Refund', icon: RotateCcw },
  other: { label: 'Other', icon: CircleEllipsis },
};

export function categoryLabel(c: TransactionCategory): string {
  return CATEGORY_META[c].label;
}
export function categoriesFor(type: TransactionType): readonly TransactionCategory[] {
  return type === 'expense' ? (EXPENSE_CATEGORIES as readonly ExpenseCategory[]) : (INCOME_CATEGORIES as readonly IncomeCategory[]);
}
export function isCategoryValidFor(type: TransactionType, category: TransactionCategory): boolean {
  return categoriesFor(type).includes(category);
}
