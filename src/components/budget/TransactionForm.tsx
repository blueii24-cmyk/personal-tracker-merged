"use client";

import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select, Textarea } from "@/components/ui/FormControls";
import { useTrackerStore } from "@/store/TrackerStoreProvider";
import { useToast } from "@/providers/ToastProvider";
import { EXPENSE_CATEGORIES, INCOME_CATEGORIES } from "@/lib/api/tracker-service";
import { todayISODate } from "@/lib/formatting";
import type { ExpenseCategory, IncomeCategory, Transaction, TransactionType } from "@/types/domain";

export function TransactionForm({
  open,
  onClose,
  transactionToEdit,
  defaultType = "expense",
}: {
  open: boolean;
  onClose: () => void;
  transactionToEdit?: Transaction | null;
  defaultType?: TransactionType;
}) {
  const { createTransaction, updateTransaction } = useTrackerStore();
  const { showToast } = useToast();

  const [type, setType] = useState<TransactionType>(defaultType);
  const [amount, setAmount] = useState("");
  const [category, setCategory] = useState<ExpenseCategory | IncomeCategory>(EXPENSE_CATEGORIES[0]);
  const [description, setDescription] = useState("");
  const [date, setDate] = useState(todayISODate());
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (transactionToEdit) {
      // Form state is reset when the dialog opens so stale values cannot leak between entries.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setType(transactionToEdit.type);
      setAmount(String(transactionToEdit.amount));
      setCategory(transactionToEdit.category);
      setDescription(transactionToEdit.description);
      setDate(transactionToEdit.date);
      setNote(transactionToEdit.note ?? "");
    } else {
      setType(defaultType);
      setAmount("");
      setCategory(defaultType === "income" ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0]);
      setDescription("");
      setDate(todayISODate());
      setNote("");
    }
    setError(null);
  }, [open, transactionToEdit, defaultType]);

  const categories = type === "income" ? INCOME_CATEGORIES : EXPENSE_CATEGORIES;

  const handleTypeChange = (next: TransactionType) => {
    setType(next);
    setCategory(next === "income" ? INCOME_CATEGORIES[0] : EXPENSE_CATEGORIES[0]);
  };

  const handleSubmit = async () => {
    setError(null);
    const value = Number(amount);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter an amount greater than zero.");
      return;
    }
    if (!description.trim()) {
      setError("Add a short description.");
      return;
    }
    setSubmitting(true);
    try {
      if (transactionToEdit) {
        await updateTransaction(transactionToEdit.id, {
          type,
          amount: value,
          category,
          description: description.trim(),
          date,
          note: note || undefined,
        });
        showToast({ title: "Transaction updated", variant: "success" });
      } else {
        await createTransaction({
          type,
          amount: value,
          category,
          description: description.trim(),
          date,
          note: note || undefined,
        });
        showToast({
          title: type === "income" ? "Income added" : "Expense added",
          description: `${category} \u00b7 ${description.trim()}`,
          variant: "success",
        });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save this transaction.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={transactionToEdit ? "Edit transaction" : "Add transaction"}
      description="Record an expense or income entry for your budget."
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-2">
          {(["expense", "income"] as TransactionType[]).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => handleTypeChange(option)}
              className={`h-10 rounded-lg border text-sm font-medium capitalize transition-colors ${
                type === option
                  ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400"
                  : "border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
              }`}
            >
              {option}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (\u20b9)" required>
            <Input type="number" min={0} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} autoFocus />
          </Field>
          <Field label="Category" required>
            <Select value={category} onChange={(e) => setCategory(e.target.value as ExpenseCategory | IncomeCategory)}>
              {categories.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <Field label="Description" required>
          <Input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={type === "income" ? "e.g. Pocket money" : "e.g. Travel to college"}
          />
        </Field>

        <Field label="Date" required>
          <Input type="date" value={date} max={todayISODate()} onChange={(e) => setDate(e.target.value)} />
        </Field>

        <Field label="Note (optional)">
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} />
        </Field>

        {error && <p className="text-sm font-medium text-danger-500">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} loading={submitting}>
            {transactionToEdit ? "Save changes" : "Add transaction"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
