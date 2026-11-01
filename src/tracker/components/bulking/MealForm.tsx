import { useState, type FormEvent } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/tracker/components/ui/Button';
import { Dialog } from '@/tracker/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/tracker/components/ui/Input';
import { useToast } from '@/tracker/components/ui/Toast';
import { useTracker } from '@/tracker/features/store/TrackerProvider';
import { toTrackerError } from '@/tracker/lib/api/errors';
import { dateKeyInTz, timeKeyInTz, zonedToIso } from '@/tracker/lib/formatting/dates';
import { fieldErrors, mealFormSchema } from '@/tracker/lib/validation/schemas';
import type { DateKey, FoodItem, FoodItemInput, Meal, MealType } from '@/tracker/types/domain';
import { MEAL_TYPES } from '@/tracker/types/domain';

interface Row {
  key: string;
  foodName: string;
  quantity: string;
  unit: string;
  calories: string;
  protein: string;
  original?: FoodItem;
}

const MEAL_LABEL: Record<MealType, string> = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner', snack: 'Snack', other: 'Other' };
export const mealTypeLabel = (t: MealType) => MEAL_LABEL[t];

let rowSeq = 0;
const blankRow = (): Row => ({ key: `r${++rowSeq}`, foodName: '', quantity: '', unit: '', calories: '', protein: '' });
const rowFromItem = (i: FoodItem): Row => ({
  key: `r${++rowSeq}`,
  foodName: i.foodName,
  quantity: i.quantity != null ? String(i.quantity) : '',
  unit: i.unit ?? '',
  calories: i.caloriesKcal != null ? String(i.caloriesKcal) : '',
  protein: i.proteinG != null ? String(i.proteinG) : '',
  original: i,
});
const toNum = (s: string): number | null => {
  const t = s.trim();
  if (t === '') return null;
  const n = Number(t);
  return Number.isNaN(n) ? NaN : n;
};

function defaultMealType(hour: number): MealType {
  return hour < 11 ? 'breakfast' : hour < 15 ? 'lunch' : hour < 18 ? 'snack' : 'dinner';
}

interface MealFormProps {
  open: boolean;
  onClose: () => void;
  /** Provide to edit; omit to create. */
  meal?: Meal;
  defaultDate: DateKey;
}

export function MealForm(props: MealFormProps) {
  return props.open ? <MealFormInner {...props} /> : null;
}

function MealFormInner({ onClose, meal, defaultDate }: MealFormProps) {
  const { createMeal, updateMeal, timezone, today } = useTracker();
  const { toast } = useToast();
  const now = new Date();
  const [mealType, setMealType] = useState<MealType>(meal?.mealType ?? defaultMealType(Number(timeKeyInTz(now, timezone).slice(0, 2))));
  const [date, setDate] = useState<DateKey>(meal ? dateKeyInTz(meal.eatenAt, timezone) : defaultDate);
  const [time, setTime] = useState(meal ? timeKeyInTz(meal.eatenAt, timezone) : date === today ? timeKeyInTz(now, timezone) : '12:00');
  const [notes, setNotes] = useState(meal?.notes ?? '');
  const [rows, setRows] = useState<Row[]>(meal ? meal.items.map(rowFromItem) : [blankRow()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const setRow = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const parsed = mealFormSchema.safeParse({
      mealType,
      date,
      time,
      notes,
      items: rows.map((r) => ({ foodName: r.foodName, quantity: toNum(r.quantity), unit: r.unit, caloriesKcal: toNum(r.calories), proteinG: toNum(r.protein) })),
    });
    if (!parsed.success) {
      setErrors(fieldErrors(parsed.error));
      return;
    }
    setErrors({});
    const v = parsed.data;
    const items: FoodItemInput[] = v.items.map((it, idx) => {
      const orig = rows[idx]?.original;
      const unchanged = orig && orig.caloriesKcal === it.caloriesKcal && orig.proteinG === it.proteinG;
      const hasNutrition = it.caloriesKcal != null || it.proteinG != null;
      return {
        foodName: it.foodName,
        quantity: it.quantity,
        unit: it.unit,
        caloriesKcal: it.caloriesKcal,
        proteinG: it.proteinG,
        isEstimate: unchanged ? orig.isEstimate : !hasNutrition,
        nutritionSource: unchanged ? orig.nutritionSource : hasNutrition ? 'user_entered' : 'unknown',
      };
    });
    const input = { mealType: v.mealType, eatenAt: zonedToIso(v.date, v.time, timezone), notes: v.notes, items };
    setSaving(true);
    try {
      if (meal) await updateMeal(meal.id, input);
      else await createMeal(input);
      toast({ title: meal ? 'Meal updated' : 'Meal logged', tone: 'success' });
      onClose();
    } catch (err) {
      setFormError(toTrackerError(err).message);
      setSaving(false);
    }
  };

  return (
    <Dialog
      open
      onClose={onClose}
      locked={saving}
      width="40rem"
      title={meal ? 'Edit meal' : 'Log a meal'}
      description="Leave calories or protein empty if you don't know them. They count as unknown, not zero."
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="meal-form" loading={saving}>
            {meal ? 'Save changes' : 'Log meal'}
          </Button>
        </>
      }
    >
      <form id="meal-form" onSubmit={submit} noValidate className="space-y-5">
        {formError && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Field label="Meal" error={errors.mealType} className="col-span-2 sm:col-span-1">
            {({ id }) => (
              <Select id={id} value={mealType} onChange={(e) => setMealType(e.target.value as MealType)}>
                {MEAL_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {MEAL_LABEL[t]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Date" error={errors.date}>
            {({ id, invalid, describedBy }) => <Input id={id} type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} aria-invalid={invalid} aria-describedby={describedBy} />}
          </Field>
          <Field label="Time" error={errors.time}>
            {({ id, invalid, describedBy }) => <Input id={id} type="time" value={time} onChange={(e) => setTime(e.target.value)} aria-invalid={invalid} aria-describedby={describedBy} />}
          </Field>
        </div>

        <fieldset className="space-y-3">
          <legend className="mb-2 text-[13px] font-medium text-ink">Foods</legend>
          {errors.items && (
            <p role="alert" className="text-xs text-danger">
              {errors.items}
            </p>
          )}
          {rows.map((r, idx) => (
            <div key={r.key} className="rounded-lg bg-sunken p-3">
              <div className="flex items-end gap-2">
                <Field label={`Food ${idx + 1}`} className="flex-1" error={errors[`items.${idx}.foodName`]}>
                  {({ id, invalid, describedBy }) => (
                    <Input id={id} value={r.foodName} onChange={(e) => setRow(r.key, { foodName: e.target.value })} placeholder="e.g. Boiled egg" aria-invalid={invalid} aria-describedby={describedBy} autoFocus={!meal && idx === 0} />
                  )}
                </Field>
                <Button variant="ghost" size="icon" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))} disabled={rows.length === 1} aria-label={`Remove food ${idx + 1}`}>
                  <Trash2 className="size-4" aria-hidden />
                </Button>
              </div>
              <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Field label="Quantity" optional error={errors[`items.${idx}.quantity`]}>
                  {({ id, invalid, describedBy }) => <Input id={id} inputMode="decimal" value={r.quantity} onChange={(e) => setRow(r.key, { quantity: e.target.value })} placeholder="2" aria-invalid={invalid} aria-describedby={describedBy} />}
                </Field>
                <Field label="Unit" optional>
                  {({ id }) => <Input id={id} value={r.unit} onChange={(e) => setRow(r.key, { unit: e.target.value })} placeholder="pieces" />}
                </Field>
                <Field label="Calories (kcal)" optional error={errors[`items.${idx}.caloriesKcal`]}>
                  {({ id, invalid, describedBy }) => <Input id={id} inputMode="decimal" value={r.calories} onChange={(e) => setRow(r.key, { calories: e.target.value })} placeholder="156" aria-invalid={invalid} aria-describedby={describedBy} />}
                </Field>
                <Field label="Protein (g)" optional error={errors[`items.${idx}.proteinG`]}>
                  {({ id, invalid, describedBy }) => <Input id={id} inputMode="decimal" value={r.protein} onChange={(e) => setRow(r.key, { protein: e.target.value })} placeholder="12.6" aria-invalid={invalid} aria-describedby={describedBy} />}
                </Field>
              </div>
            </div>
          ))}
          <Button variant="secondary" size="sm" onClick={() => setRows((rs) => [...rs, blankRow()])} disabled={rows.length >= 25}>
            <Plus className="size-4" aria-hidden />
            Add food
          </Button>
        </fieldset>

        <Field label="Notes" optional error={errors.notes}>
          {({ id }) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} />}
        </Field>
      </form>
    </Dialog>
  );
}
