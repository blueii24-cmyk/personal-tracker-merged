import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TrackerService } from '@/tracker/lib/api/tracker-service';
import { toTrackerError, type TrackerError } from '@/tracker/lib/api/errors';
import { todayKey } from '@/tracker/lib/formatting/dates';
import type {
  AiStatus, DashboardSummary, Meal, MealInput, Transaction, TransactionInput, UserSettings, UserSettingsInput, WeighIn, WeighInInput,
} from '@/tracker/types/domain';

type Status = 'loading' | 'ready' | 'error';

interface TrackerState {
  status: Status;
  error: TrackerError | null;
  meals: Meal[];
  transactions: Transaction[];
  weighIns: WeighIn[];
  settings: UserSettings | null;
  summary: DashboardSummary | null;
  aiStatus: AiStatus | null;
}

export interface TrackerApi extends TrackerState {
  service: TrackerService;
  /** Today in the user's timezone (re-evaluated every minute). */
  today: string;
  timezone: string;
  refresh: () => Promise<void>;
  createMeal: (i: MealInput) => Promise<Meal>;
  updateMeal: (id: string, i: MealInput) => Promise<Meal>;
  deleteMeal: (id: string) => Promise<() => Promise<void>>;
  createTransaction: (i: TransactionInput) => Promise<Transaction>;
  updateTransaction: (id: string, i: TransactionInput) => Promise<Transaction>;
  deleteTransaction: (id: string) => Promise<() => Promise<void>>;
  createWeighIn: (i: WeighInInput) => Promise<WeighIn>;
  updateWeighIn: (id: string, i: WeighInInput) => Promise<WeighIn>;
  deleteWeighIn: (id: string) => Promise<() => Promise<void>>;
  updateSettings: (i: UserSettingsInput) => Promise<UserSettings>;
}

const TrackerContext = createContext<TrackerApi | null>(null);

const INITIAL: TrackerState = { status: 'loading', error: null, meals: [], transactions: [], weighIns: [], settings: null, summary: null, aiStatus: null };
const FALLBACK_TZ = 'Asia/Kolkata';

/**
 * One shared in-memory view of the user's records. Every mutation goes through the service first and the
 * UI only changes after the service resolves — so totals on every screen always reflect what was saved.
 */
export function TrackerProvider({ service, children }: { service: TrackerService; children: ReactNode }) {
  const [state, setState] = useState<TrackerState>(INITIAL);
  const [today, setToday] = useState(() => todayKey(FALLBACK_TZ));
  const seq = useRef(0);

  const refresh = useCallback(async () => {
    const mine = ++seq.current;
    try {
      const [meals, transactions, weighIns, settings, summary, aiStatus] = await Promise.all([
        service.getMeals(),
        service.getTransactions(),
        service.getWeighIns(),
        service.getUserSettings(),
        service.getDashboardSummary(),
        service.getAiStatus(),
      ]);
      if (mine !== seq.current) return; // a newer refresh superseded this one
      setState({ status: 'ready', error: null, meals, transactions, weighIns, settings, summary, aiStatus });
    } catch (e) {
      if (mine !== seq.current) return;
      setState((s) => ({ ...s, status: s.settings ? 'ready' : 'error', error: toTrackerError(e) }));
      throw e;
    }
  }, [service]);

  useEffect(() => {
    refresh().catch(() => undefined);
  }, [refresh]);

  const timezone = state.settings?.timezone ?? FALLBACK_TZ;
  useEffect(() => {
    const tick = () => {
      const t = todayKey(timezone);
      setToday((prev) => {
        if (prev !== t) refresh().catch(() => undefined); // day rolled over: recompute "today" totals
        return t;
      });
    };
    tick();
    const id = window.setInterval(tick, 60_000);
    // Timers are paused while the phone is asleep or the app is in the background, so re-check on return.
    const onVisible = () => {
      if (document.visibilityState === 'visible') tick();
    };
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onVisible);
    return () => {
      window.clearInterval(id);
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onVisible);
    };
  }, [timezone, refresh]);

  const api = useMemo<TrackerApi>(() => {
    const after = async <T,>(p: Promise<T>): Promise<T> => {
      const result = await p;
      await refresh();
      return result;
    };
    const del = <T,>(remove: () => Promise<void>, restore: () => Promise<T>) =>
      after(remove()).then(() => async () => {
        await after(restore());
      });

    return {
      ...state,
      service,
      today,
      timezone,
      refresh,
      createMeal: (i) => after(service.createMeal(i)),
      updateMeal: (id, i) => after(service.updateMeal(id, i)),
      deleteMeal: (id) => {
        const prev = state.meals.find((m) => m.id === id);
        return del(() => service.deleteMeal(id), () => service.restoreMeal(prev!));
      },
      createTransaction: (i) => after(service.createTransaction(i)),
      updateTransaction: (id, i) => after(service.updateTransaction(id, i)),
      deleteTransaction: (id) => {
        const prev = state.transactions.find((t) => t.id === id);
        return del(() => service.deleteTransaction(id), () => service.restoreTransaction(prev!));
      },
      createWeighIn: (i) => after(service.createWeighIn(i)),
      updateWeighIn: (id, i) => after(service.updateWeighIn(id, i)),
      deleteWeighIn: (id) => {
        const prev = state.weighIns.find((w) => w.id === id);
        return del(() => service.deleteWeighIn(id), () => service.restoreWeighIn(prev!));
      },
      updateSettings: (i) => after(service.updateUserSettings(i)),
    };
  }, [state, service, today, timezone, refresh]);

  return <TrackerContext.Provider value={api}>{children}</TrackerContext.Provider>;
}

export function useTracker(): TrackerApi {
  const ctx = useContext(TrackerContext);
  if (!ctx) throw new Error('useTracker must be used inside <TrackerProvider>');
  return ctx;
}

/** For pages that cannot render without data: returns the ready state or null while loading/failed. */
export function useReadyTracker(): (TrackerApi & { settings: UserSettings; summary: DashboardSummary }) | null {
  const t = useTracker();
  return t.status === 'ready' && t.settings && t.summary ? (t as TrackerApi & { settings: UserSettings; summary: DashboardSummary }) : null;
}
