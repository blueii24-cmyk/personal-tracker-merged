import { ErrorState } from '@/tracker/components/ui/EmptyState';
import { Skeleton } from '@/tracker/components/ui/Skeleton';
import { PageContainer } from '@/tracker/components/layout/AppShell';
import { PageHeader } from '@/tracker/components/layout/PageHeader';
import { useTracker } from '@/tracker/features/store/TrackerProvider';
import { AccountSection } from '@/tracker/components/account/AccountSection';
import { AiSection } from './AiSection';
import { AppearanceSection, BudgetSection, BulkingSection, DataSection, ProfileSection } from './SettingsSections';

export default function SettingsPage() {
  const t = useTracker();
  if (t.status === 'error') return <PageContainer><ErrorState message={t.error?.message ?? 'Something went wrong.'} onRetry={() => void t.refresh().catch(() => undefined)} /></PageContainer>;
  if (t.status !== 'ready' || !t.settings) {
    return (
      <PageContainer>
        <div role="status" aria-label="Loading settings" className="max-w-3xl space-y-4">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </PageContainer>
    );
  }
  // Each section is keyed on its own saved fields, so it resets to what was stored after its own save
  // without discarding unsaved edits in the other sections.
  const s = t.settings;
  const profileKey = JSON.stringify([s.displayName, s.email, s.timezone]);
  const bulkingKey = JSON.stringify([s.dailyCalorieTarget, s.dailyProteinTargetG, s.targetWeightKg, s.weightUnit]);
  const budgetKey = JSON.stringify([s.monthlyBudget, s.openingBalance]);
  return (
    <PageContainer>
      <PageHeader title="Settings" description="Your profile, targets and preferences. Your records live on their own pages." />
      <div className="max-w-3xl space-y-5">
        <ProfileSection key={profileKey} settings={s} />
        <BulkingSection key={bulkingKey} settings={s} />
        <BudgetSection key={budgetKey} settings={s} />
        <AccountSection />
        <AppearanceSection />
        <AiSection />
        <DataSection />
      </div>
    </PageContainer>
  );
}
