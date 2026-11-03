import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { User } from '@supabase/supabase-js';
import { isBackendConfigured } from '@/tracker/config';
import { useTracker } from '@/tracker/features/store/TrackerProvider';
import { getSupabase } from '@/tracker/lib/supabase/client';
import { isNative } from '@/tracker/lib/platform/native';
import { isSyncCapable, type SyncStatus } from '@/tracker/sync/synced-service';
import { purgeAccountCache } from '@/tracker/sync/account-cache';
import { SupabaseRemote } from '@/tracker/sync/supabase-remote';
import { MergeDialog } from '@/tracker/components/account/MergeDialog';
import { parseAuthCallback, preferredAuthRedirect } from './callback';

const LOCAL_STATUS: SyncStatus = { state: 'local-only', signedIn: false, email: null, pending: 0, conflicts: 0, lastSyncedAt: null, message: null };

export interface AuthApi {
  /** Supabase variables are present in this build. */
  configured: boolean;
  /** The service can sync (always true today; false would mean a plain local-only service). */
  restoring: boolean;
  user: { id: string; email: string } | null;
  sync: SyncStatus;
  recovery: boolean;
  signIn(email: string, password: string): Promise<string | null>;
  signUp(email: string, password: string): Promise<{ error: string | null; needsConfirmation: boolean }>;
  signOut(opts?: { forgetDevice?: boolean }): Promise<string | null>;
  sendReset(email: string): Promise<string | null>;
  setNewPassword(password: string): Promise<string | null>;
  handleAuthCallback(url: string): Promise<{ handled: boolean; error: string | null; recovery?: boolean }>;
  syncNow(): void;
  openMerge(): void;
}

const AuthContext = createContext<AuthApi | null>(null);
export function useAuth(): AuthApi {
  const v = useContext(AuthContext);
  if (!v) throw new Error('useAuth must be used inside <AuthProvider>');
  return v;
}

/** Turns a Supabase auth error into something a person can act on, without echoing server internals. */
export function authMessage(e: { message?: string; status?: number; code?: string } | null | undefined): string {
  const m = (e?.message ?? '').toLowerCase();
  if (!e) return 'Something went wrong. Try again.';
  if (/failed to fetch|network|load failed|fetch/.test(m) || e.status === 0) return "Couldn't reach the sign-in service. Check your connection and try again.";
  if (/invalid login credentials/.test(m)) return 'That email and password don’t match. Check them and try again.';
  if (/email not confirmed/.test(m)) return 'Confirm your email first: open the link we sent you, then sign in.';
  if (/already registered|already been registered/.test(m)) return 'An account with that email already exists. Sign in instead.';
  if (/password/.test(m) && /(short|least|weak|characters)/.test(m)) return 'Choose a longer password (at least 8 characters).';
  if (/rate limit|too many|over_email_send_rate_limit/.test(m) || e.status === 429) return 'Too many attempts. Wait a minute and try again.';
  if (/signups? (are )?(not allowed|disabled)/.test(m)) return 'New sign-ups are turned off for this app.';
  return 'Sign-in failed. Try again in a moment.';
}

const redirectTo = (): string | undefined => preferredAuthRedirect(
  isNative(),
  process.env.NEXT_PUBLIC_AUTH_REDIRECT_URL ?? '',
  typeof window === 'undefined' ? undefined : window.location.origin,
);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { service, refresh } = useTracker();
  const sb = useMemo(() => getSupabase(), []);
  const cap = isSyncCapable(service) ? service : null;
  const [user, setUser] = useState<AuthApi['user']>(null);
  const [restoring, setRestoring] = useState(Boolean(sb && cap));
  const [sync, setSync] = useState<SyncStatus>(cap ? cap.getSyncStatus() : LOCAL_STATUS);
  const [recovery, setRecovery] = useState(false);
  const [mergeOpen, setMergeOpen] = useState(false);
  const refreshRef = useRef(refresh);
  useEffect(() => {
    refreshRef.current = refresh;
  }, [refresh]);

  useEffect(() => {
    if (!cap) return;
    return cap.subscribeSync((s, changed) => {
      setSync(s);
      if (changed) refreshRef.current().catch(() => undefined);
    });
  }, [cap]);

  useEffect(() => {
    if (!sb || !cap) return;
    let alive = true;
    const apply = async (u: User | null) => {
      if (!alive) return;
      if (!u) {
        cap.detachAccount();
        setUser(null);
        await refreshRef.current().catch(() => undefined);
        return;
      }
      const me = { id: u.id, email: u.email ?? '' };
      const already = cap.getSyncStatus().signedIn && cap.getSyncStatus().email === me.email;
      setUser(me);
      await cap.attachAccount(me, new SupabaseRemote(sb, me.id));
      if (already) {
        void cap.syncNow();
        return;
      }
      await refreshRef.current().catch(() => undefined);
      await cap.syncNow();
      if (alive && cap.needsMergePrompt()) setMergeOpen(true);
    };
    // Never await Supabase calls inside this callback (it can deadlock the client): defer the work.
    const { data } = sb.auth.onAuthStateChange((event, session) => {
      if (event === 'PASSWORD_RECOVERY') setRecovery(true);
      setTimeout(() => {
        void apply(session?.user ?? null).finally(() => alive && setRestoring(false));
      }, 0);
    });
    return () => {
      alive = false;
      data.subscription.unsubscribe();
    };
  }, [sb, cap]);

  // Retry on reconnect, when the app comes back to the foreground, and quietly every minute while it is open.
  useEffect(() => {
    if (!cap || !user) return;
    const go = () => void cap.syncNow();
    const onVisible = () => document.visibilityState === 'visible' && go();
    window.addEventListener('online', go);
    window.addEventListener('focus', go);
    document.addEventListener('visibilitychange', onVisible);
    const id = window.setInterval(() => document.visibilityState === 'visible' && go(), 60_000);
    return () => {
      window.removeEventListener('online', go);
      window.removeEventListener('focus', go);
      document.removeEventListener('visibilitychange', onVisible);
      window.clearInterval(id);
    };
  }, [cap, user]);

  const handleAuthCallback = useCallback(async (raw: string) => {
    const parsed = parseAuthCallback(raw);
    if (!parsed) return { handled: false, error: null };
    if (parsed.error) return { handled: true, error: parsed.error };
    if (!sb || !parsed.callback) return { handled: true, error: 'Cloud sync isn’t set up in this build.' };
    setRestoring(true);
    const { error } = await sb.auth.exchangeCodeForSession(parsed.callback.code);
    if (error) {
      setRestoring(false);
      return { handled: true, error: authMessage(error) };
    }
    if (parsed.callback.recovery) setRecovery(true);
    // onAuthStateChange adopts the session, attaches the account partition,
    // and starts sync. Do not duplicate that work here.
    return { handled: true, error: null, recovery: parsed.callback.recovery };
  }, [sb]);

  const api = useMemo<AuthApi>(
    () => ({
      configured: isBackendConfigured && Boolean(sb),
      restoring,
      user,
      sync,
      recovery,
      async signIn(email, password) {
        if (!sb) return 'Cloud sync isn’t set up in this build.';
        const { error } = await sb.auth.signInWithPassword({ email: email.trim(), password });
        return error ? authMessage(error) : null;
      },
      async signUp(email, password) {
        if (!sb) return { error: 'Cloud sync isn’t set up in this build.', needsConfirmation: false };
        const { data, error } = await sb.auth.signUp({ email: email.trim(), password, options: { emailRedirectTo: redirectTo() } });
        if (error) return { error: authMessage(error), needsConfirmation: false };
        // An existing address returns a user with no identities (Supabase hides whether it exists).
        return { error: null, needsConfirmation: !data.session };
      },
      async signOut(opts) {
        if (!sb || !cap) return null;
        const id = user?.id;
        // Try to upload what is pending first, so nothing stays only on this device by accident.
        await cap.syncNow();
        const left = cap.getSyncStatus().pending;
        if (opts?.forgetDevice && left > 0) return `${left} change${left === 1 ? ' is' : 's are'} not uploaded yet, so this device's copy was kept. Connect and try again.`;
        const { error } = await sb.auth.signOut();
        if (error) return authMessage(error);
        if (opts?.forgetDevice && id) purgeAccountCache(id);
        return null;
      },
      async sendReset(email) {
        if (!sb) return 'Cloud sync isn’t set up in this build.';
        const { error } = await sb.auth.resetPasswordForEmail(email.trim(), { redirectTo: redirectTo() });
        return error ? authMessage(error) : null;
      },
      async setNewPassword(password) {
        if (!sb) return 'Cloud sync isn’t set up in this build.';
        const { error } = await sb.auth.updateUser({ password });
        if (error) return authMessage(error);
        setRecovery(false);
        return null;
      },
      handleAuthCallback,
      syncNow: () => void cap?.syncNow(),
      openMerge: () => setMergeOpen(true),
    }),
    [sb, cap, restoring, user, sync, recovery, handleAuthCallback],
  );

  const onMerged = useCallback(() => void refreshRef.current().catch(() => undefined), []);
  return (
    <AuthContext.Provider value={api}>
      {children}
      {cap && user && <MergeDialog open={mergeOpen} service={cap} onClose={() => setMergeOpen(false)} onMerged={onMerged} />}
    </AuthContext.Provider>
  );
}
