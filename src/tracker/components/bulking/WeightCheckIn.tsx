import { useState, type FormEvent } from 'react';
import { Scale } from 'lucide-react';
import { Button } from '@/tracker/components/ui/Button';
import { Dialog } from '@/tracker/components/ui/Dialog';
import { Field, Input, Textarea } from '@/tracker/components/ui/Input';
import { useToast } from '@/tracker/components/ui/Toast';
import { useTracker } from '@/tracker/features/store/TrackerProvider';
import { toTrackerError } from '@/tracker/lib/api/errors';
import { dateKeyInTz, timeKeyInTz, zonedToIso } from '@/tracker/lib/formatting/dates';
import { kgToUnit, unitToKg, weightRangeError } from '@/tracker/lib/formatting/nutrition';
import { fieldErrors, weighInFormSchema } from '@/tracker/lib/validation/schemas';
import type { DateKey, WeighIn } from '@/tracker/types/domain';

/** Inline "log today's weight" control. */
export function WeightCheckIn({ defaultDate }: { defaultDate: DateKey }) {
  const { createWeighIn, settings, timezone, today } = useTracker();
  const { toast } = useToast();
  const unit = settings?.weightUnit ?? 'kg';
  const [value, setValue] = useState('');
  const [date, setDate] = useState<DateKey>(defaultDate);
  const [error, setError] = useState<string | undefined>();
  const [saving, setSaving] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = weighInFormSchema.safeParse({ value: value.trim() === '' ? NaN : Number(value), date, time: date === today ? timeKeyInTz(new Date(), timezone) : '07:00', notes: '' });
    if (!parsed.success) {
      setError(fieldErrors(parsed.error).value ?? fieldErrors(parsed.error).date ?? 'Check the details');
      return;
    }
    const rangeError = weightRangeError(parsed.data.value, unit);
    if (rangeError) {
      setError(rangeError);
      return;
    }
    setError(undefined);
    setSaving(true);
    try {
      await createWeighIn({ weightKg: Math.round(unitToKg(parsed.data.value, unit) * 100) / 100, recordedAt: zonedToIso(parsed.data.date, parsed.data.time, timezone), notes: null });
      toast({ title: 'Weight logged', tone: 'success' });
      setValue('');
    } catch (err) {
      setError(toTrackerError(err).message);
    } finally {
      setSaving(false);
    }
  };

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-3 sm:flex-row sm:items-end">
      <Field label={`Weight (${unit})`} error={error} className="sm:w-40">
        {({ id, invalid, describedBy }) => <Input id={id} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} placeholder={unit === 'kg' ? '48.2' : '106.2'} aria-invalid={invalid} aria-describedby={describedBy} />}
      </Field>
      <Field label="Date" className="sm:w-44">
        {({ id }) => <Input id={id} type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />}
      </Field>
      <Button variant="primary" type="submit" loading={saving} className="sm:mb-0">
        <Scale className="size-4" aria-hidden />
        Log weight
      </Button>
    </form>
  );
}

export function WeighInEditDialog({ weighIn, onClose }: { weighIn: WeighIn | null; onClose: () => void }) {
  return weighIn ? <EditInner weighIn={weighIn} onClose={onClose} /> : null;
}

function EditInner({ weighIn, onClose }: { weighIn: WeighIn; onClose: () => void }) {
  const { updateWeighIn, settings, timezone, today } = useTracker();
  const { toast } = useToast();
  const unit = settings?.weightUnit ?? 'kg';
  const [value, setValue] = useState(String(Math.round(kgToUnit(weighIn.weightKg, unit) * 10) / 10));
  const [date, setDate] = useState(dateKeyInTz(weighIn.recordedAt, timezone));
  const [notes, setNotes] = useState(weighIn.notes ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const originalDate = dateKeyInTz(weighIn.recordedAt, timezone);
  const time = timeKeyInTz(weighIn.recordedAt, timezone);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const parsed = weighInFormSchema.safeParse({ value: value.trim() === '' ? NaN : Number(value), date, time, notes });
    if (!parsed.success) return setErrors(fieldErrors(parsed.error));
    const rangeError = weightRangeError(parsed.data.value, unit);
    if (rangeError) return setErrors({ value: rangeError });
    setErrors({});
    setSaving(true);
    try {
      await updateWeighIn(weighIn.id, {
        weightKg: Math.round(unitToKg(parsed.data.value, unit) * 100) / 100,
        recordedAt: date === originalDate ? weighIn.recordedAt : zonedToIso(parsed.data.date, parsed.data.time, timezone),
        notes: parsed.data.notes,
      });
      toast({ title: 'Weight updated', tone: 'success' });
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
      title="Edit weight entry"
      width="26rem"
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button variant="primary" type="submit" form="weight-form" loading={saving}>
            Save changes
          </Button>
        </>
      }
    >
      <form id="weight-form" onSubmit={submit} noValidate className="space-y-4">
        {formError && (
          <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
            {formError}
          </p>
        )}
        <Field label={`Weight (${unit})`} error={errors.value}>
          {({ id, invalid, describedBy }) => <Input id={id} inputMode="decimal" value={value} onChange={(e) => setValue(e.target.value)} aria-invalid={invalid} aria-describedby={describedBy} autoFocus />}
        </Field>
        <Field label="Date" error={errors.date}>
          {({ id }) => <Input id={id} type="date" value={date} max={today} onChange={(e) => setDate(e.target.value)} />}
        </Field>
        <Field label="Notes" optional error={errors.notes}>
          {({ id }) => <Textarea id={id} value={notes} onChange={(e) => setNotes(e.target.value)} rows={2} maxLength={500} />}
        </Field>
      </form>
    </Dialog>
  );
}
