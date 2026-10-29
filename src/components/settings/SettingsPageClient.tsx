"use client";

import { useEffect, useState } from "react";
import { Bot, Flame, Laptop, Moon, Sun, User, Wallet } from "lucide-react";
import { Card, CardBody, CardHeader } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Field, Input, Select } from "@/components/ui/FormControls";
import { Badge, Skeleton } from "@/components/ui/Feedback";
import { useTrackerStore } from "@/store/TrackerStoreProvider";
import { useToast } from "@/providers/ToastProvider";
import { useTheme, type ThemePreference } from "@/providers/ThemeProvider";
import type { UserSettings } from "@/types/domain";

const TIMEZONES = ["Asia/Kolkata", "Asia/Dubai", "Asia/Singapore", "Europe/London", "America/New_York", "UTC"];

export function SettingsPageClient() {
  const { settings, settingsLoading, updateSettings } = useTrackerStore();

  if (settingsLoading || !settings) {
    return (
      <div className="flex flex-col gap-6">
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-48 w-full" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <ProfileSection settings={settings} onSave={updateSettings} />
      <BulkingSection settings={settings} onSave={updateSettings} />
      <BudgetSection settings={settings} onSave={updateSettings} />
      <AppearanceSection />
      <AiSection settings={settings} />
    </div>
  );
}

function SaveButton({ onClick, loading }: { onClick: () => void; loading: boolean }) {
  return (
    <div className="flex justify-end">
      <Button size="sm" onClick={onClick} loading={loading}>
        Save changes
      </Button>
    </div>
  );
}

function ProfileSection({
  settings,
  onSave,
}: {
  settings: UserSettings;
  onSave: (input: Partial<UserSettings>) => Promise<UserSettings>;
}) {
  const { showToast } = useToast();
  const [displayName, setDisplayName] = useState(settings.displayName);
  const [timezone, setTimezone] = useState(settings.timezone);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Keep editable fields synchronized when settings are loaded or changed elsewhere.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDisplayName(settings.displayName);
    setTimezone(settings.timezone);
  }, [settings]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave({ displayName: displayName.trim() || settings.displayName, timezone });
      showToast({ title: "Profile updated", variant: "success" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader icon={<User size={18} />} title="Profile" subtitle="Your display details for this demo account" />
      <CardBody className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Display name" required>
            <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} />
          </Field>
          <Field label="Email" hint="Managed by your future account provider">
            <Input value={settings.email} disabled />
          </Field>
          <Field label="Timezone">
            <Select value={timezone} onChange={(e) => setTimezone(e.target.value)}>
              {TIMEZONES.map((tz) => (
                <option key={tz} value={tz}>
                  {tz}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <SaveButton onClick={handleSave} loading={saving} />
      </CardBody>
    </Card>
  );
}

function BulkingSection({
  settings,
  onSave,
}: {
  settings: UserSettings;
  onSave: (input: Partial<UserSettings>) => Promise<UserSettings>;
}) {
  const { showToast } = useToast();
  const [calorieTarget, setCalorieTarget] = useState(String(settings.calorieTarget));
  const [proteinTarget, setProteinTarget] = useState(String(settings.proteinTarget));
  const [weightUnit, setWeightUnit] = useState(settings.weightUnit);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Keep editable fields synchronized when settings are loaded or changed elsewhere.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCalorieTarget(String(settings.calorieTarget));
    setProteinTarget(String(settings.proteinTarget));
    setWeightUnit(settings.weightUnit);
  }, [settings]);

  const handleSave = async () => {
    setError(null);
    const calories = Number(calorieTarget);
    const protein = Number(proteinTarget);
    if (!Number.isFinite(calories) || calories <= 0 || !Number.isFinite(protein) || protein <= 0) {
      setError("Enter valid positive numbers for both targets.");
      return;
    }
    setSaving(true);
    try {
      await onSave({ calorieTarget: calories, proteinTarget: protein, weightUnit });
      showToast({ title: "Bulking targets updated", variant: "success" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader icon={<Flame size={18} />} title="Bulking" subtitle="Set your own daily nutrition targets" />
      <CardBody className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Daily calorie target" required>
            <Input type="number" min={0} value={calorieTarget} onChange={(e) => setCalorieTarget(e.target.value)} />
          </Field>
          <Field label="Daily protein target (g)" required>
            <Input type="number" min={0} value={proteinTarget} onChange={(e) => setProteinTarget(e.target.value)} />
          </Field>
          <Field label="Preferred weight unit">
            <Select value={weightUnit} onChange={(e) => setWeightUnit(e.target.value as "kg" | "lb")}>
              <option value="kg">Kilograms (kg)</option>
              <option value="lb">Pounds (lb)</option>
            </Select>
          </Field>
        </div>
        {error && <p className="text-sm font-medium text-danger-500">{error}</p>}
        <SaveButton onClick={handleSave} loading={saving} />
      </CardBody>
    </Card>
  );
}

function BudgetSection({
  settings,
  onSave,
}: {
  settings: UserSettings;
  onSave: (input: Partial<UserSettings>) => Promise<UserSettings>;
}) {
  const { showToast } = useToast();
  const [monthlyBudget, setMonthlyBudget] = useState(String(settings.monthlyBudget));
  const [cycleStartDay, setCycleStartDay] = useState(String(settings.budgetCycleStartDay));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    // Keep editable fields synchronized when settings are loaded or changed elsewhere.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMonthlyBudget(String(settings.monthlyBudget));
    setCycleStartDay(String(settings.budgetCycleStartDay));
  }, [settings]);

  const handleSave = async () => {
    setError(null);
    const budget = Number(monthlyBudget);
    const startDay = Number(cycleStartDay);
    if (!Number.isFinite(budget) || budget <= 0) {
      setError("Enter a monthly budget greater than zero.");
      return;
    }
    if (!Number.isFinite(startDay) || startDay < 1 || startDay > 28) {
      setError("Budget start day should be between 1 and 28.");
      return;
    }
    setSaving(true);
    try {
      await onSave({ monthlyBudget: budget, budgetCycleStartDay: startDay });
      showToast({ title: "Budget settings updated", variant: "success" });
    } finally {
      setSaving(false);
    }
  };

  return (
    <Card>
      <CardHeader icon={<Wallet size={18} />} title="Budget" subtitle="Your monthly budget and currency" />
      <CardBody className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <Field label="Monthly budget (\u20b9)" required>
            <Input type="number" min={0} value={monthlyBudget} onChange={(e) => setMonthlyBudget(e.target.value)} />
          </Field>
          <Field label="Currency">
            <Input value="INR (\u20b9)" disabled />
          </Field>
          <Field label="Budget cycle start day" hint="Day of month your budget cycle resets">
            <Input type="number" min={1} max={28} value={cycleStartDay} onChange={(e) => setCycleStartDay(e.target.value)} />
          </Field>
        </div>
        {error && <p className="text-sm font-medium text-danger-500">{error}</p>}
        <SaveButton onClick={handleSave} loading={saving} />
      </CardBody>
    </Card>
  );
}

function AppearanceSection() {
  const { theme, setTheme } = useTheme();

  const options: Array<{ value: ThemePreference; label: string; icon: typeof Sun }> = [
    { value: "light", label: "Light", icon: Sun },
    { value: "dark", label: "Dark", icon: Moon },
    { value: "system", label: "System", icon: Laptop },
  ];

  return (
    <Card>
      <CardHeader title="Appearance" subtitle="Your theme preference is saved on this device" />
      <CardBody>
        <div className="grid grid-cols-3 gap-2">
          {options.map((option) => {
            const Icon = option.icon;
            const active = theme === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => setTheme(option.value)}
                className={`flex flex-col items-center gap-2 rounded-xl border p-4 text-sm font-medium transition-colors ${
                  active
                    ? "border-brand-500 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-400"
                    : "border-[var(--border-strong)] text-[var(--text-secondary)] hover:bg-[var(--surface-sunken)]"
                }`}
              >
                <Icon size={18} />
                {option.label}
              </button>
            );
          })}
        </div>
      </CardBody>
    </Card>
  );
}

function AiSection({ settings }: { settings: UserSettings }) {
  return (
    <Card>
      <CardHeader icon={<Bot size={18} />} title="AI preferences" subtitle="Provider configuration is managed by the backend" />
      <CardBody className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Provider">
            <Input value={settings.aiProvider} disabled />
          </Field>
          <Field label="Model">
            <Input value={settings.aiModel} disabled />
          </Field>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={settings.aiConnected ? "success" : "warning"}>
            {settings.aiConnected ? "Connected" : "Demo mode \u2014 not connected"}
          </Badge>
        </div>
        <p className="rounded-lg border border-dashed border-[var(--border-strong)] p-3 text-xs text-[var(--text-secondary)]">
          For security, AI provider credentials are never entered or stored in the browser. Once a backend AI endpoint
          (e.g. <code className="rounded bg-[var(--surface-sunken)] px-1 py-0.5">/functions/v1/ai-chat</code>) is configured, its
          provider, model and connection status will appear here automatically.
        </p>
      </CardBody>
    </Card>
  );
}
