import { useRef, useState, type ChangeEvent, type FormEvent, type ReactNode } from 'react';
import { Download, Monitor, Moon, Sun, Trash2, Upload } from 'lucide-react';
import { Button } from '@/tracker/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/tracker/components/ui/Card';
import { ConfirmDialog } from '@/tracker/components/ui/Dialog';
import { Field, Input, Select } from '@/tracker/components/ui/Input';
import { Segmented } from '@/tracker/components/ui/Segmented';
import { useToast } from '@/tracker/components/ui/Toast';
import { useTheme, type ThemePreference } from '@/tracker/features/theme/ThemeProvider';
import { useTracker } from '@/tracker/features/store/TrackerProvider';
import { toTrackerError } from '@/tracker/lib/api/errors';
import { COMMON_TIMEZONES } from '@/tracker/lib/formatting/dates';
import { kgToUnit, unitToKg } from '@/tracker/lib/formatting/nutrition';
import { budgetSettingsSchema, bulkingSettingsSchema, fieldErrors, profileSchema } from '@/tracker/lib/validation/schemas';
import type { UserSettings, WeightUnit } from '@/tracker/types/domain';
import { parseBackup } from '@/tracker/lib/api/mock/persistence';
import type { ExportBundle } from '@/tracker/lib/api/tracker-service';
import { isNative } from '@/tracker/lib/platform/native';
import { downloadFile, toCsv } from './export';

/** Shared card + form chrome: a Save button that only enables when something changed. */
function SettingsCard({ id, title, description, children, dirty, saving, onSubmit, error, footerNote }: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
  dirty: boolean;
  saving: boolean;
  onSubmit: (e: FormEvent) => void;
  error?: string | null;
  footerNote?: ReactNode;
}) {
  return (
    <Card>
      <CardHeader as="h2" title={<span id={`${id}-title`}>{title}</span>} description={description} />
      <form onSubmit={onSubmit} noValidate aria-labelledby={`${id}-title`}>
        <CardBody className="space-y-4">
          {error && (
            <p role="alert" className="rounded-md bg-danger-soft px-3 py-2 text-sm text-danger">
              {error}
            </p>
          )}
          {children}
        </CardBody>
        <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-3 sm:px-5">
          <p className="text-xs text-ink-3">{footerNote}</p>
          <Button variant="primary" type="submit" disabled={!dirty} loading={saving}>
            Save changes
          </Button>
        </div>
      </form>
    </Card>
  );
}

function useSave() {
  const { updateSettings } = useTracker();
  const { toast } = useToast();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const save = async (patch: Partial<UserSettings>, done: string): Promise<boolean> => {
    setSaving(true);
    setError(null);
    try {
      await updateSettings(patch);
      toast({ title: done, tone: 'success' });
      return true;
    } catch (e) {
      setError(toTrackerError(e).message);
      return false;
    } finally {
      setSaving(false);
    }
  };
  return { saving, error, save };
}

const numStr = (n: number | null | undefined) => (n == null ? '' : String(n));
const toNullable = (s: string): number | null => (s.trim() === '' ? null : Number(s.replace(/,/g, '')));
const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d;

function timezoneOptions(current: string): string[] {
  let all: string[] = [];
  try {
    all = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    /* older engines */
  }
  const list = all.length ? all : [...COMMON_TIMEZONES];
  return list.includes(current) ? list : [current, ...list];
}

export function ProfileSection({ settings }: { settings: UserSettings }) {
  const { saving, error, save } = useSave();
  const [name, setName] = useState(settings.displayName);
  const [tz, setTz] = useState(settings.timezone);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = name !== settings.displayName || tz !== settings.timezone;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const p = profileSchema.safeParse({ displayName: name, timezone: tz });
    if (!p.success) return setErrors(fieldErrors(p.error));
    setErrors({});
    await save(p.data, 'Profile saved');
  };
  return (
    <SettingsCard id="profile" title="Profile" description="How the app greets you and decides what “today” means." dirty={dirty} saving={saving} onSubmit={submit} error={error}
      footerNote="Changing the timezone changes which day each record belongs to.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Display name" error={errors.displayName}>
          {({ id, invalid, describedBy }) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} maxLength={60} aria-invalid={invalid} aria-describedby={describedBy} autoComplete="nickname" />}
        </Field>
        <Field label="Timezone" error={errors.timezone}>
          {({ id, invalid, describedBy }) => (
            <Select id={id} value={tz} onChange={(e) => setTz(e.target.value)} aria-invalid={invalid} aria-describedby={describedBy}>
              {timezoneOptions(settings.timezone).map((z) => (
                <option key={z} value={z}>
                  {z.replace(/_/g, ' ')}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Account" hint="Your account email appears here after sign-in. Without an account, records stay only on this device.">
        {({ id, describedBy }) => <Input id={id} value={settings.email} readOnly aria-describedby={describedBy} />}
      </Field>
    </SettingsCard>
  );
}

export function BulkingSection({ settings }: { settings: UserSettings }) {
  const { saving, error, save } = useSave();
  const [unit, setUnit] = useState<WeightUnit>(settings.weightUnit);
  const [kcal, setKcal] = useState(numStr(settings.dailyCalorieTarget));
  const [protein, setProtein] = useState(numStr(settings.dailyProteinTargetG));
  const targetStored = settings.targetWeightKg == null ? '' : String(round(kgToUnit(settings.targetWeightKg, settings.weightUnit)));
  const [target, setTarget] = useState(targetStored);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const changeUnit = (u: WeightUnit) => {
    // Re-express the target weight in the new unit so the stored kg value doesn't change.
    const n = toNullable(target);
    if (n != null && !Number.isNaN(n)) setTarget(String(round(kgToUnit(unitToKg(n, unit), u))));
    setUnit(u);
  };

  const targetKg = (() => {
    const n = toNullable(target);
    return n == null || Number.isNaN(n) ? n : round(unitToKg(n, unit), 2);
  })();
  const dirty = unit !== settings.weightUnit || toNullable(kcal) !== settings.dailyCalorieTarget || toNullable(protein) !== settings.dailyProteinTargetG || targetKg !== settings.targetWeightKg;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const p = bulkingSettingsSchema.safeParse({ dailyCalorieTarget: toNullable(kcal), dailyProteinTargetG: toNullable(protein), targetWeightKg: targetKg, weightUnit: unit });
    if (!p.success) return setErrors(fieldErrors(p.error));
    setErrors({});
    await save(p.data, 'Bulking settings saved');
  };
  return (
    <SettingsCard id="bulking" title="Bulking" description="Your own daily targets. The app never suggests numbers for you." dirty={dirty} saving={saving} onSubmit={submit} error={error}
      footerNote="Leave a field empty to have no target. Progress bars then show totals only.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Daily calorie target (kcal)" optional error={errors.dailyCalorieTarget}>
          {({ id, invalid, describedBy }) => <Input id={id} inputMode="numeric" value={kcal} onChange={(e) => setKcal(e.target.value)} placeholder="Not set" aria-invalid={invalid} aria-describedby={describedBy} />}
        </Field>
        <Field label="Daily protein target (g)" optional error={errors.dailyProteinTargetG}>
          {({ id, invalid, describedBy }) => <Input id={id} inputMode="decimal" value={protein} onChange={(e) => setProtein(e.target.value)} placeholder="Not set" aria-invalid={invalid} aria-describedby={describedBy} />}
        </Field>
        <Field label={`Target weight (${unit})`} optional error={errors.targetWeightKg} hint="Shown as a dashed line on weight charts.">
          {({ id, invalid, describedBy }) => <Input id={id} inputMode="decimal" value={target} onChange={(e) => setTarget(e.target.value)} placeholder="Not set" aria-invalid={invalid} aria-describedby={describedBy} />}
        </Field>
        <div>
          <span className="mb-1.5 block text-[13px] font-medium text-ink" id="unit-label">Weight unit</span>
          <Segmented<WeightUnit> label="Weight unit" value={unit} onChange={changeUnit} options={[{ value: 'kg', label: 'Kilograms (kg)' }, { value: 'lb', label: 'Pounds (lb)' }]} />
          <p className="mt-1.5 text-xs text-ink-3">Records are stored in kg and converted for display.</p>
        </div>
      </div>
    </SettingsCard>
  );
}

export function BudgetSection({ settings }: { settings: UserSettings }) {
  const { saving, error, save } = useSave();
  const [budget, setBudget] = useState(numStr(settings.monthlyBudget));
  const [opening, setOpening] = useState(numStr(settings.openingBalance));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const dirty = toNullable(budget) !== settings.monthlyBudget || toNullable(opening) !== settings.openingBalance;
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const p = budgetSettingsSchema.safeParse({ monthlyBudget: toNullable(budget), openingBalance: opening.trim() === '' ? 0 : toNullable(opening) });
    if (!p.success) return setErrors(fieldErrors(p.error));
    setErrors({});
    await save(p.data, 'Budget settings saved');
  };
  return (
    <SettingsCard id="budget" title="Budget" description="A monthly spending limit, plus where your tracked balance starts." dirty={dirty} saving={saving} onSubmit={submit} error={error}
      footerNote="Budgets run on calendar months, from the 1st to the last day.">
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Monthly budget (₹)" optional error={errors.monthlyBudget} hint="The most you want to spend in a month. It is not your account balance.">
          {({ id, invalid, describedBy }) => <Input id={id} inputMode="decimal" value={budget} onChange={(e) => setBudget(e.target.value)} placeholder="Not set" aria-invalid={invalid} aria-describedby={describedBy} />}
        </Field>
        <Field label="Opening balance (₹)" error={errors.openingBalance} hint="Cash you had when you started tracking. Leave 0 if unsure.">
          {({ id, invalid, describedBy }) => <Input id={id} inputMode="decimal" value={opening} onChange={(e) => setOpening(e.target.value)} aria-invalid={invalid} aria-describedby={describedBy} />}
        </Field>
        <Field label="Currency" hint="Indian rupees only for now.">
          {({ id, describedBy }) => (
            <Select id={id} value="INR" disabled aria-describedby={describedBy} onChange={() => undefined}>
              <option value="INR">INR (₹)</option>
            </Select>
          )}
        </Field>
      </div>
    </SettingsCard>
  );
}

export function AppearanceSection() {
  const { preference, setPreference, resolved } = useTheme();
  return (
    <Card>
      <CardHeader as="h2" title="Appearance" description="Saved on this device." />
      <CardBody>
        <Segmented<ThemePreference>
          label="Theme"
          value={preference}
          onChange={setPreference}
          options={[
            { value: 'light', label: <><Sun className="size-4" aria-hidden />Light</> },
            { value: 'dark', label: <><Moon className="size-4" aria-hidden />Dark</> },
            { value: 'system', label: <><Monitor className="size-4" aria-hidden />System</> },
          ]}
        />
        <p className="mt-2 text-xs text-ink-3">{preference === 'system' ? `Following your device. It is currently ${resolved}.` : `Always ${preference}.`}</p>
      </CardBody>
    </Card>
  );
}

export function DataSection() {
  const t = useTracker();
  const { toast } = useToast();
  const [busy, setBusy] = useState<'json' | 'csv' | 'restore' | 'erase' | null>(null);
  const [confirm, setConfirm] = useState<'restore' | 'erase' | null>(null);
  const [pending, setPending] = useState<ExportBundle | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const where = t.service.mode === 'connected' ? 'in your account and on this device' : isNative() ? 'on this device' : 'in this browser';

  const run = async (kind: 'json' | 'csv') => {
    setBusy(kind);
    try {
      const data = await t.service.exportData();
      const stamp = data.exportedAt.slice(0, 10);
      const result =
        kind === 'json'
          ? await downloadFile(`personal-tracker-${stamp}.json`, JSON.stringify(data, null, 2), 'application/json')
          : await downloadFile(
              `transactions-${stamp}.csv`,
              toCsv(['id', 'date_time', 'type', 'amount_inr', 'category', 'description', 'notes'], data.transactions.map((x) => [x.id, x.occurredAt, x.type, x.amount, x.category, x.description, x.notes ?? ''])),
              'text/csv',
            );
      if (result === 'cancelled') toast({ title: 'Export cancelled', description: 'Nothing was saved or shared.', tone: 'error' });
      else toast({ title: 'Export ready', description: result === 'shared' ? 'Choose where to keep the file in the share sheet.' : 'The file was downloaded to your device.', tone: 'success' });
    } catch (e) {
      toast({ title: "Couldn't export", description: toTrackerError(e).message, tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const chooseFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow choosing the same file again
    if (!file) return;
    try {
      const parsed = parseBackup(await file.text());
      if (!parsed.ok) return toast({ title: "Couldn't read that backup", description: parsed.error, tone: 'error' });
      setPending(parsed.bundle);
      setConfirm('restore');
    } catch {
      toast({ title: "Couldn't read that file", description: 'Try choosing it again.', tone: 'error' });
    }
  };

  const restore = async () => {
    if (!pending) return;
    setBusy('restore');
    try {
      const n = await t.service.importData(pending);
      await t.refresh();
      toast({ title: 'Backup restored', description: `${n.meals} meals, ${n.transactions} transactions and ${n.weighIns} weigh-ins are now on this device.`, tone: 'success' });
      setConfirm(null);
      setPending(null);
    } catch (err) {
      toast({ title: "Couldn't restore", description: toTrackerError(err).message, tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const erase = async () => {
    setBusy('erase');
    try {
      await t.service.eraseAllData();
      await t.refresh();
      toast({ title: 'All records deleted', description: 'Your settings were kept.', tone: 'success' });
      setConfirm(null);
    } catch (e) {
      toast({ title: "Couldn't delete", description: toTrackerError(e).message, tone: 'error' });
    } finally {
      setBusy(null);
    }
  };

  const closeIfIdle = () => {
    if (busy) return;
    setConfirm(null);
    setPending(null);
  };

  return (
    <Card>
      <CardHeader as="h2" title="Your data" description="Records are kept separate from these settings." />
      <CardBody className="space-y-4">
        <div className="flex flex-wrap gap-2">
          <Button onClick={() => run('json')} loading={busy === 'json'}>
            <Download className="size-4" aria-hidden />
            Export everything (JSON)
          </Button>
          <Button onClick={() => run('csv')} loading={busy === 'csv'}>
            <Download className="size-4" aria-hidden />
            Transactions (CSV)
          </Button>
          <Button onClick={() => fileInput.current?.click()} loading={busy === 'restore'}>
            <Upload className="size-4" aria-hidden />
            Restore from backup
          </Button>
          <input ref={fileInput} type="file" accept=".json,application/json" className="hidden" onChange={chooseFile} aria-label="Choose a backup file to restore" />
        </div>
        <p className="text-[13px] text-ink-3">
          Your records live only {where}. Uninstalling the app or clearing its data deletes them, so export a backup from time to time and keep the file somewhere safe. Restoring a backup restores meals, transactions, weigh-ins and settings; chats and your AI key are not included.
        </p>
        <div className="rounded-lg border border-line p-3.5">
          <p className="text-sm font-medium text-ink">Delete all my records</p>
          <p className="mt-0.5 text-[13px] text-ink-3">Starts you from an empty tracker: removes every meal, transaction, weigh-in and conversation {where}. Your settings stay.</p>
          <Button variant="secondary" className="mt-3" onClick={() => setConfirm('erase')}>
            <Trash2 className="size-4" aria-hidden />
            Delete all records
          </Button>
        </div>
      </CardBody>
      <ConfirmDialog
        open={confirm === 'restore' && pending !== null}
        title="Restore this backup?"
        description={
          pending && (
            <>
              This replaces the meals, transactions, weigh-ins and settings {where} with the backup from {pending.exportedAt.slice(0, 10)}: {pending.meals.length} meals, {pending.transactions.length} transactions and {pending.weighIns.length} weigh-ins. Anything added since then will be lost. This can&apos;t be undone, so export a backup of what you have now first if you might need it.
            </>
          )
        }
        confirmLabel="Replace my records"
        loading={busy === 'restore'}
        onConfirm={restore}
        onClose={closeIfIdle}
      />
      <ConfirmDialog open={confirm === 'erase'} title="Delete all records?" description={`Every meal, transaction, weigh-in and conversation ${where} will be permanently deleted. Export a backup first if you might want them back. This can't be undone.`} confirmLabel="Delete everything" loading={busy === 'erase'} onConfirm={erase} onClose={closeIfIdle} />
    </Card>
  );
}
