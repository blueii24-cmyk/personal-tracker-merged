"use client";

import { Plus, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { Dialog } from "@/components/ui/Dialog";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/FormControls";
import { useTrackerStore } from "@/store/TrackerStoreProvider";
import { useToast } from "@/providers/ToastProvider";
import { MEAL_TYPES } from "@/lib/api/tracker-service";
import type { Meal, MealType } from "@/types/domain";

interface DraftItem {
  name: string;
  quantity: string;
  calories: string;
  protein: string;
}

function emptyItem(): DraftItem {
  return { name: "", quantity: "", calories: "", protein: "" };
}

export function MealForm({
  open,
  onClose,
  mealToEdit,
}: {
  open: boolean;
  onClose: () => void;
  mealToEdit?: Meal | null;
}) {
  const { createMeal, updateMeal } = useTrackerStore();
  const { showToast } = useToast();

  const [type, setType] = useState<MealType>("breakfast");
  const [items, setItems] = useState<DraftItem[]>([emptyItem()]);
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (mealToEdit) {
      // Form state is reset when the dialog opens so stale values cannot leak between entries.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setType(mealToEdit.type);
      setItems(
        mealToEdit.items.map((i) => ({
          name: i.name,
          quantity: i.quantity,
          calories: String(i.calories),
          protein: String(i.protein),
        })),
      );
      setNote(mealToEdit.note ?? "");
    } else {
      setType("breakfast");
      setItems([emptyItem()]);
      setNote("");
    }
    setError(null);
  }, [open, mealToEdit]);

  const updateItem = (index: number, patch: Partial<DraftItem>) => {
    setItems((prev) => prev.map((item, i) => (i === index ? { ...item, ...patch } : item)));
  };

  const removeItem = (index: number) => {
    setItems((prev) => prev.filter((_, i) => i !== index));
  };

  const handleSubmit = async () => {
    setError(null);
    const cleaned = items
      .map((item) => ({
        name: item.name.trim(),
        quantity: item.quantity.trim() || "1 serving",
        calories: Number(item.calories),
        protein: Number(item.protein || 0),
        isEstimate: true,
      }))
      .filter((item) => item.name.length > 0);

    if (cleaned.length === 0) {
      setError("Add at least one food item with a name.");
      return;
    }
    if (cleaned.some((item) => !Number.isFinite(item.calories) || item.calories < 0)) {
      setError("Enter a valid calorie value (0 or more) for every item.");
      return;
    }

    setSubmitting(true);
    try {
      if (mealToEdit) {
        await updateMeal(mealToEdit.id, { type, items: cleaned, note: note || undefined });
        showToast({ title: "Meal updated", variant: "success" });
      } else {
        await createMeal({ type, items: cleaned, note: note || undefined });
        showToast({ title: "Meal logged", description: "Saved to today's nutrition log.", variant: "success" });
      }
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't save this meal.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={mealToEdit ? "Edit meal" : "Log a meal"}
      description="Add each food item with its estimated calories and protein."
      maxWidthClassName="max-w-xl"
    >
      <div className="flex flex-col gap-4">
        <Field label="Meal type" required>
          <Select value={type} onChange={(e) => setType(e.target.value as MealType)}>
            {MEAL_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.charAt(0).toUpperCase() + t.slice(1)}
              </option>
            ))}
          </Select>
        </Field>

        <div className="flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-[var(--text-primary)]">Food items</span>
            <Button type="button" variant="ghost" size="sm" onClick={() => setItems((prev) => [...prev, emptyItem()])}>
              <Plus size={14} /> Add item
            </Button>
          </div>
          {items.map((item, index) => (
            <div key={index} className="rounded-lg border border-[var(--border-subtle)] p-3">
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Input
                  placeholder="Food name"
                  value={item.name}
                  onChange={(e) => updateItem(index, { name: e.target.value })}
                  className="col-span-2 sm:col-span-1"
                  aria-label="Food name"
                />
                <Input
                  placeholder="Quantity"
                  value={item.quantity}
                  onChange={(e) => updateItem(index, { quantity: e.target.value })}
                  aria-label="Quantity"
                />
                <Input
                  placeholder="Calories"
                  type="number"
                  min={0}
                  value={item.calories}
                  onChange={(e) => updateItem(index, { calories: e.target.value })}
                  aria-label="Calories"
                />
                <div className="flex gap-2">
                  <Input
                    placeholder="Protein (g)"
                    type="number"
                    min={0}
                    value={item.protein}
                    onChange={(e) => updateItem(index, { protein: e.target.value })}
                    aria-label="Protein grams"
                  />
                  {items.length > 1 && (
                    <button
                      type="button"
                      onClick={() => removeItem(index)}
                      aria-label="Remove item"
                      className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg text-[var(--text-tertiary)] hover:bg-danger-50 hover:text-danger-500"
                    >
                      <Trash2 size={16} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>

        <Field label="Note (optional)">
          <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. post-workout meal" />
        </Field>

        {error && <p className="text-sm font-medium text-danger-500">{error}</p>}

        <div className="flex justify-end gap-2 pt-1">
          <Button type="button" variant="outline" onClick={onClose} disabled={submitting}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSubmit} loading={submitting}>
            {mealToEdit ? "Save changes" : "Log meal"}
          </Button>
        </div>
      </div>
    </Dialog>
  );
}
