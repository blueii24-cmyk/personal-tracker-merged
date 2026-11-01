import { useState, type FormEvent } from 'react';
import { Button } from '@/tracker/components/ui/Button';
import { Dialog } from '@/tracker/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/tracker/components/ui/Input';
import { Segmented } from '@/tracker/components/ui/Segmented';
import { useToast } from '@/tracker/components/ui/Toast';
import { categoriesFor, categoryLabel, isCategoryValidFor } from '@/tracker/features/transactions/categories';
import { useTracker } from '@/tracker/features/store/TrackerProvider';
import { toTrackerError } from '@/tracker/lib/api/errors';
import { dateKeyInTz, timeKeyInTz, zonedToIso } from '@/tracker/lib/formatting/dates';
import { fieldErrors, transactionFormSchema } from '@/tracker/lib/validation/schemas';
import type { DateKey, Transaction, TransactionCategory, TransactionType } from '@/tracker/types/domain';

interface Props {
  open: boolean;
  onClose: () => void;
  /** Edit an existing record; omit to create. */
  transaction?: Transaction;
  initialType?: TransactionType;
  defaultDate?: DateKey;
}

export function TransactionForm(props: Props) {
  return props.open ? <Inner {...props} /> : null;
}

function Inner({ onClose, transaction, initialType = 'expense', defaultDate }: Props) {
  const { createTransaction, updateTransaction, timezone, today } = useTracker();
  const { toast } = useToast();
  const originalDate = transaction ? dateKeyInTz(transaction.occurredAt, timezone) : null;
  const [type, setType] = useState<TransactionType>(transaction?.type ?? initialType);
  const [amount, setAmount] = useState(transaction ? String(transaction.amount) : '');
  const [category, setCategory] = useState<TransactionCategory>(transaction?.category ?? categoriesFor(initialType)[0]!);
  const [description, setDescription] = useState(transaction?.description ?? '');
  const [date, setDate] = useState<DateKey>(originalDate ?? defaultDate ?? today);
  const [notes, setNotes] = useState(transaction?.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const changeType = (next: TransactionType) => {
    setType(next);
    if (!isCategoryValidFor(next, category)) setCategory(categoriesFor(next)[0]!);
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setFormError(null);
    const cleaned = amount.replace(/[₹,\s]/g, '');
    const timeOfDay = transaction ? timeKeyInTz(transaction.occurredAt, timezone) : date === today ? timeKeyInTz(new Date(), timezone) : '12:00';
    const parsed = transactionFormSchema.safeParse({ type, amount: cleaned === '' ? NaN : Number(cleaned), category, description, date, time: timeOfDay, notes });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    setErrors({});
    const v = parsed.data;
    const input = {
      type: v.type,
      amount: Math.round(v.amount * 100) / 100,
      category: v.category as TransactionCategory,
      description: v.description,
      merchant: transaction?.merchant ?? null,
      notes: v.notes,
      occurredAt: transaction && date === originalDate ? transaction.occurredAt : zonedToIso(v.date, v.time, timezone),
    };
    setSaving(true);
    try {
      if (transaction) await updateTransaction(transaction.id, input);
      else await createTransaction(input);
      toast({ title: transaction ? 'Transaction updated' : v.type === 'expense' ? 'Expense added' : 'Income added', tone: 'success' });
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
      title={transaction ? 'Edit transaction' : type === 'expense' ? 'Add an expense' : 'Add income'}
      width="28rem"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="tx-form" loading={saving}>
            {transaction ? 'Save changes' : type === 'expense' ? 'Add expense' : 'Add income'}
          </Button>
        </>
      }
    >
      <form id="tx-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}
        <Segmented<TransactionType>
          label="Transaction type"
          value={type}
          onChange={changeType}
          className="w-full [&>button]:flex-1"
          options={[
            { value: 'expense', label: 'Expense' },
            { value: 'income', label: 'Income' },
          ]}
        />
        <div className="grid grid-cols-2 gap-3">
          <Field label="Amount (₹)" error={errors.amount}>
            {({ id, invalid, describedBy }) => (
              <Input id={id} inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} placeholder="60" aria-invalid={invalid} aria-describedby={describedBy} autoFocus={!transaction} />
            )}
          </Field>
          <Field label="Date" error={errors.date}>
            {({ id, invalid, describedBy }) => <Input id={id} type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} aria-invalid={invalid} aria-describedby={describedBy} />}
          </Field>
        </div>
        <Field label="Category" error={errors.category}>
          {({ id, invalid, describedBy }) => (
            <Select id={id} value={category} onChange={(e) => setCategory(e.target.value as TransactionCategory)} aria-invalid={invalid} aria-describedby={describedBy}>
              {categoriesFor(type).map((c) => (
                <option key={c} value={c}>
                  {categoryLabel(c)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Description" error={errors.description}>
          {({ id, invalid, describedBy }) => (
            <Input id={id} value={description} onChange={(e) => setDescription(e.target.value)} placeholder={type === 'expense' ? 'e.g. Bus to college' : 'e.g. Monthly pocket money'} maxLength={500} aria-invalid={invalid} aria-describedby={describedBy} />
          )}
        </Field>
        <Field label="Notes" optional error={errors.notes}>
          {({ id }) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} />}
        </Field>
      </form>
    </Dialog>
  );
}
