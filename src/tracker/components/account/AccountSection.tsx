import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { Cloud, GitMerge, LogOut, RefreshCw } from 'lucide-react';
import { Button } from '@/tracker/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/tracker/components/ui/Card';
import { ConfirmDialog } from '@/tracker/components/ui/Dialog';
import { Badge } from '@/tracker/components/ui/Badge';
import { Field, Input } from '@/tracker/components/ui/Input';
import { Segmented } from '@/tracker/components/ui/Segmented';
import { useToast } from '@/tracker/components/ui/Toast';
import { useAuth } from '@/tracker/features/auth/AuthProvider';
import { useTracker } from '@/tracker/features/store/TrackerProvider';
import { syncLabel } from '@/tracker/components/layout/SyncNotice';
import { isSyncCapable } from '@/tracker/sync/synced-service';
import { isNative } from '@/tracker/lib/platform/native';

const MIN_PASSWORD = 8;

function SignedOutForm() {
  const auth = useAuth();
  const { toast } = useToast();
  const [mode, setMode] = useState<'in' | 'up' | 'reset'>('in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setError(null);
    setNote(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError('Enter a valid email address.');
    if (mode !== 'reset' && password.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters for the password.`);
    setBusy(true);
    try {
      if (mode === 'in') {
        const e = await auth.signIn(email, password);
        if (e) setError(e);
        else toast({ title: 'Signed in', description: 'Your records are syncing.', tone: 'success' });
      } else if (mode === 'up') {
        const r = await auth.signUp(email, password);
        if (r.error) setError(r.error);
        else if (r.needsConfirmation) setNote(isNative() ? 'Check your email and open the confirmation link. It returns to this app and connects your account automatically.' : 'Check your email and open the confirmation link to finish creating your account.');
        else toast({ title: 'Account created', tone: 'success' });
      } else {
        const e = await auth.sendReset(email);
        if (e) setError(e);
        else setNote('If that address has an account, a reset link is on its way.' + (isNative() ? ' The link opens in your browser: set the new password there, then sign in here.' : ''));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-4" noValidate>
      <Segmented<'in' | 'up' | 'reset'> label="Account action" value={mode} onChange={(m) => { setMode(m); setError(null); setNote(null); }} options={[{ value: 'in', label: 'Sign in' }, { value: 'up', label: 'Create account' }, { value: 'reset', label: 'Forgot password' }]} />
      <Field label="Email">
        {(f) => <Input id={f.id} type="email" autoComplete="email" inputMode="email" className="h-11" value={email} onChange={(e) => setEmail(e.target.value)} aria-describedby={f.describedBy} />}
      </Field>
      {mode !== 'reset' && (
        <Field label="Password" hint={mode === 'up' ? `At least ${MIN_PASSWORD} characters.` : undefined}>
          {(f) => <Input id={f.id} type="password" autoComplete={mode === 'in' ? 'current-password' : 'new-password'} className="h-11" value={password} onChange={(e) => setPassword(e.target.value)} aria-describedby={f.describedBy} />}
        </Field>
      )}
      <div aria-live="polite" className="min-h-5 text-sm">
        {error && <p role="alert" className="text-danger">{error}</p>}
        {note && <p className="text-success">{note}</p>}
      </div>
      <Button type="submit" variant="primary" loading={busy}>{mode === 'in' ? 'Sign in' : mode === 'up' ? 'Create account' : 'Send reset link'}</Button>
    </form>
  );
}

function RecoveryForm() {
  const auth = useAuth();
  const { toast } = useToast();
  const [pw, setPw] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    if (pw.length < MIN_PASSWORD) return setError(`Use at least ${MIN_PASSWORD} characters.`);
    setBusy(true);
    const e = await auth.setNewPassword(pw);
    setBusy(false);
    if (e) setError(e);
    else toast({ title: 'Password updated', tone: 'success' });
  };
  return (
    <form onSubmit={(e) => void submit(e)} className="space-y-3 rounded-2xl bg-primary-container px-4 py-4 text-on-primary-container">
      <p className="text-sm font-medium">Choose a new password</p>
      <Field label="New password" error={error ?? undefined}>{(f) => <Input id={f.id} type="password" autoComplete="new-password" className="h-11" value={pw} onChange={(e) => setPw(e.target.value)} aria-describedby={f.describedBy} aria-invalid={f.invalid} />}</Field>
      <Button type="submit" variant="primary" loading={busy}>Update password</Button>
    </form>
  );
}

function SignedIn() {
  const auth = useAuth();
  const t = useTracker();
  const { toast } = useToast();
  const cap = isSyncCapable(t.service) ? t.service : null;
  const [confirmOut, setConfirmOut] = useState<null | 'keep' | 'forget'>(null);
  const [busy, setBusy] = useState(false);
  const { text, tone } = syncLabel(auth.sync);
  const conflicts = cap?.getConflicts() ?? [];

  const out = async () => {
    setBusy(true);
    const e = await auth.signOut({ forgetDevice: confirmOut === 'forget' });
    setBusy(false);
    setConfirmOut(null);
    if (e) toast({ title: "Couldn't finish signing out", description: e, tone: 'error' });
    else toast({ title: 'Signed out', description: confirmOut === 'forget' ? "This account's copy was removed from this device." : 'This device now shows its own local records again.', tone: 'success' });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl bg-sunken px-4 py-3.5">
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-ink">{auth.user?.email}</p>
          <p className="text-xs text-ink-3">
            {auth.sync.lastSyncedAt ? `Last synced ${new Date(auth.sync.lastSyncedAt).toLocaleString()}` : 'Not synced yet'}
          </p>
        </div>
        <Badge tone={tone === 'ok' ? 'success' : tone === 'bad' ? 'danger' : tone === 'busy' ? 'neutral' : 'warning'}>{text}</Badge>
      </div>
      {auth.sync.message && <p role="alert" className="text-sm text-danger">{auth.sync.message}</p>}
      <p className="text-[13px] text-ink-2">
        Changes are saved on this device first, so everything works offline, and are uploaded when you&apos;re connected. Records here are separate from the local records you had before signing in.
      </p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" onClick={() => auth.syncNow()} loading={auth.sync.state === 'syncing'}><RefreshCw className="size-4" aria-hidden />Sync now</Button>
        <Button size="sm" onClick={() => auth.openMerge()}><GitMerge className="size-4" aria-hidden />Merge this device&apos;s local records…</Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmOut('keep')}><LogOut className="size-4" aria-hidden />Sign out</Button>
        <Button size="sm" variant="ghost" onClick={() => setConfirmOut('forget')}>Sign out and remove from this device</Button>
      </div>

      {conflicts.length > 0 && (
        <div className="space-y-2" aria-label="Needs review">
          <p className="text-sm font-medium text-ink">Needs review ({conflicts.length})</p>
          <p className="text-[13px] text-ink-2">The same record was changed in two places. One version was kept automatically; the other is saved here so nothing is lost.</p>
          <ul className="space-y-2">
            {conflicts.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl bg-warning-soft px-4 py-3 text-sm text-warning">
                <span className="min-w-0">
                  <span className="block font-medium capitalize">{c.kind.replace(/([A-Z])/g, ' $1').toLowerCase()}</span>
                  <span className="block text-xs">Kept the {c.keptVersion === 'cloud' ? 'account' : 'device'} version ({c.reason.replace(/-/g, ' ')}).</span>
                </span>
                <span className="flex gap-2">
                  <Button size="sm" variant="subtle" onClick={() => { try { cap?.resolveConflict(c.id, 'restore'); } catch { toast({ title: "Couldn't restore that version", tone: 'error' }); } }}>Use the other version</Button>
                  <Button size="sm" variant="ghost" onClick={() => cap?.resolveConflict(c.id, 'dismiss')}>Keep as is</Button>
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      <ConfirmDialog
        open={confirmOut !== null}
        tone="primary"
        title={confirmOut === 'forget' ? 'Sign out and remove this account from the device?' : 'Sign out?'}
        description={confirmOut === 'forget' ? "Pending changes are uploaded first. Then this account's cached records are removed from this device. They stay in your account." : "You'll go back to the records stored only on this device. Your account's records stay in the cloud and on this device until you remove them."}
        confirmLabel="Sign out"
        loading={busy}
        onConfirm={() => void out()}
        onClose={() => !busy && setConfirmOut(null)}
      />
    </div>
  );
}

export function AccountSection() {
  const auth = useAuth();
  const { hash } = useLocation();
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (hash === '#account') wrap.current?.scrollIntoView({ block: 'start' });
  }, [hash]);

  return (
    <div ref={wrap} id="account" className="scroll-mt-6">
      <Card>
        <CardHeader
          as="h2"
          icon={<Cloud className="size-5" aria-hidden />}
          title="Account & sync"
          description={auth.configured ? 'Optional. Sign in to keep a copy of your records in the cloud and use them on more than one device.' : 'Cloud sync isn’t set up in this build, so your records stay on this device.'}
          action={<Badge tone={auth.user ? 'success' : 'warning'}>{auth.user ? 'Signed in' : auth.configured ? 'Local only' : 'Not set up'}</Badge>}
        />
        <CardBody className="space-y-4">
          {!auth.configured ? (
            <p className="text-sm text-ink-2">The app works fully without an account. To turn cloud sync on, the app needs its Supabase project details at build time (see docs/SUPABASE_SETUP.md).</p>
          ) : auth.restoring ? (
            <p className="text-sm text-ink-3" role="status">Checking your sign-in…</p>
          ) : (
            <>
              {auth.recovery && <RecoveryForm />}
              {auth.user ? <SignedIn /> : <SignedOutForm />}
            </>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
