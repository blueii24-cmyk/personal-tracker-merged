import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router-dom';
import { CheckCircle2, KeyRound, Lock, PauseCircle, PlayCircle, RefreshCw, ShieldAlert, Sparkles, Trash2, Zap } from 'lucide-react';
import { Badge } from '@/tracker/components/ui/Badge';
import { Button } from '@/tracker/components/ui/Button';
import { Card, CardBody, CardHeader } from '@/tracker/components/ui/Card';
import { ConfirmDialog } from '@/tracker/components/ui/Dialog';
import { Field, Input, Select, Textarea } from '@/tracker/components/ui/Input';
import { Segmented } from '@/tracker/components/ui/Segmented';
import { useToast } from '@/tracker/components/ui/Toast';
import { useAiConfig } from '@/tracker/features/ai-config/AiConfigProvider';
import { useTracker } from '@/tracker/features/store/TrackerProvider';
import { toTrackerError } from '@/tracker/lib/api/errors';
import { baseUrlError, configError, NOTES_MAX, PROVIDERS, providerInfo, SERVER_PRESETS, type ByokConfig, type KeyStorage } from '@/tracker/lib/ai/byok/config';
import { fetchModels, type ModelListing } from '@/tracker/lib/ai/byok/models';
import { testConnection } from '@/tracker/lib/ai/byok/run-chat';
import type { AiProviderId } from '@/tracker/lib/ai/provider';

type Errors = Partial<Record<'model' | 'baseUrl' | 'notes' | 'key', string>>;
type Test = { state: 'idle' } | { state: 'running' } | { state: 'ok'; ms: number; model: string; switched: boolean } | { state: 'error'; message: string };
type Detect = { state: 'idle' } | { state: 'loading' } | { state: 'error'; message: string };

/** How many detected models to offer in the list. The rest are still ranked, just not shown. */
const LIST_LIMIT = 40;

function keyProblem(key: string): string | undefined {
  const k = key.trim();
  if (!k) return 'Paste your API key.';
  if (/\s/.test(k)) return 'A key has no spaces or line breaks. Copy it again.';
  if (k.length < 8) return 'That looks too short to be a key.';
  return undefined;
}

export function AiSection() {
  const { aiStatus } = useTracker();
  const ai = useAiConfig();
  const { toast } = useToast();
  const { hash } = useLocation();
  const wrap = useRef<HTMLDivElement>(null);

  const [draft, setDraft] = useState<ByokConfig>(ai.config);
  const [key, setKey] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  const [test, setTest] = useState<Test>({ state: 'idle' });
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [listing, setListing] = useState<ModelListing | null>(null);
  const [detect, setDetect] = useState<Detect>({ state: 'idle' });
  const [detectNonce, setDetectNonce] = useState(0);
  const [typing, setTyping] = useState(false);
  const draftRef = useRef(draft);
  draftRef.current = draft;
  const patch = (p: Partial<ByokConfig>) => {
    setDraft((d) => ({ ...d, ...p }));
    setTest({ state: 'idle' });
  };

  // Detect the models this key can use whenever the provider, server or key changes (and on "Detect models").
  useEffect(() => {
    const d = draftRef.current;
    const apiKey = key.trim() || ai.getKey();
    if (!apiKey || keyProblem(apiKey) || (d.providerId === 'openai-compatible' && baseUrlError(d.baseUrl))) {
      setListing(null);
      setDetect({ state: 'idle' });
      return;
    }
    const ctrl = new AbortController();
    setDetect({ state: 'loading' });
    const timer = window.setTimeout(async () => {
      try {
        const l = await fetchModels({ providerId: d.providerId, baseUrl: d.baseUrl }, apiKey, ctrl.signal);
        if (ctrl.signal.aborted) return;
        setListing(l);
        if (!l.best) {
          setDetect({ state: 'error', message: `${l.totalCount} models were listed, but none of them can chat with tools.` });
          return;
        }
        setDetect({ state: 'idle' });
        const best = l.best.id;
        if (draftRef.current.autoModel) setDraft((x) => ({ ...x, model: best }));
      } catch (err) {
        if (ctrl.signal.aborted) return;
        setListing(null);
        setDetect({ state: 'error', message: toTrackerError(err).message });
      }
    }, 700);
    return () => {
      window.clearTimeout(timer);
      ctrl.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draft.providerId, draft.baseUrl, key, ai.hasKey, detectNonce]);

  useEffect(() => {
    if (hash === '#ai') wrap.current?.scrollIntoView({ block: 'start' });
  }, [hash]);

  const info = providerInfo(draft.providerId);
  const keyNeeded = !ai.hasKey || key.trim() !== '';

  const validate = (): Errors => {
    const e: Errors = { ...configError(draft) };
    if (keyNeeded) {
      const k = keyProblem(key);
      if (k) e.key = k;
    }
    setErrors(e);
    return e;
  };

  const submit = (ev: FormEvent) => {
    ev.preventDefault();
    if (Object.keys(validate()).length) return;
    const problem = ai.save({ ...draft, enabled: true }, key.trim() ? key : undefined);
    if (problem) {
      setErrors({ key: problem });
      return;
    }
    setKey('');
    toast({ title: 'Your model is on', description: 'Chat now uses it. Records still stay in this browser.', tone: 'success' });
  };

  const runTest = async () => {
    const e = validate();
    if (Object.keys(e).length) return;
    const apiKey = key.trim() || ai.getKey();
    setTest({ state: 'running' });
    // In auto mode, if the first choice turns out to be unavailable to this key, try the next best few.
    const candidates = draft.autoModel && listing
      ? [draft.model, ...listing.models.map((m) => m.id).filter((id) => id !== draft.model)].slice(0, 4)
      : [draft.model];
    let failure = 'Could not reach the model.';
    for (const model of candidates) {
      try {
        const r = await testConnection({ ...draft, model }, apiKey);
        const switched = model !== draft.model;
        if (switched) setDraft((d) => ({ ...d, model }));
        setTest({ state: 'ok', ms: r.ms, model, switched });
        return;
      } catch (err) {
        const te = toTrackerError(err);
        failure = te.message;
        if (te.code !== 'AI_MODEL_NOT_FOUND' && te.code !== 'INVALID_REQUEST') break;
      }
    }
    setTest({ state: 'error', message: failure });
  };

  const setMode = (mode: 'auto' | 'manual') => {
    if (mode === 'auto') patch({ autoModel: true, model: listing?.best?.id ?? draft.model });
    else {
      patch({ autoModel: false });
    }
  };

  const picked = listing?.models.find((m) => m.id === draft.model) ?? null;
  const best = listing?.best ?? null;
  const shown = listing ? listing.models.slice(0, LIST_LIMIT) : [];
  const pickedHidden = !!listing && !!draft.model && !shown.some((m) => m.id === draft.model);

  const active = ai.active;
  const badge = active
    ? { tone: 'success' as const, label: 'Your model' }
    : ai.config.enabled && !ai.hasKey
      ? { tone: 'warning' as const, label: 'Key needed' }
      : ai.hasKey
        ? { tone: 'neutral' as const, label: 'Paused' }
        : { tone: 'warning' as const, label: 'Demo assistant' };

  return (
    <div id="ai" ref={wrap} className="scroll-mt-20">
      <Card>
        <CardHeader as="h2" title="AI assistant" description="Use your own AI account for chat. It is pre-set for budgeting and bulking only." action={<Badge tone={badge.tone}>{badge.label}</Badge>} />
        <CardBody className="space-y-5">
          <p className="text-sm text-ink-2" data-testid="ai-status">
            {active
              ? `Chat is answered by ${providerInfo(ai.config.providerId).label}, model ${ai.config.model}${ai.config.autoModel ? ' (picked automatically)' : ''}. Your key ${ai.keyHint} is used from this browser.`
              : ai.config.enabled && !ai.hasKey
                ? "Your key isn't saved in this tab any more (it was set to this tab only). Add it again below to keep using your model."
                : ai.hasKey
                  ? 'Your key is saved but paused. Chat is using the built-in demo assistant.'
                  : (aiStatus?.detail ?? 'Replies come from a built-in rule-based demo assistant. No AI provider is called.')}
          </p>

          {ai.hasKey && (
            <div className="flex flex-wrap gap-2">
              {ai.config.enabled ? (
                <Button size="sm" onClick={() => ai.setEnabled(false)}>
                  <PauseCircle className="size-4" aria-hidden />
                  Pause and use demo
                </Button>
              ) : (
                <Button size="sm" onClick={() => ai.setEnabled(true)} disabled={Object.keys(configError(ai.config)).length > 0}>
                  <PlayCircle className="size-4" aria-hidden />
                  Use my model
                </Button>
              )}
              <Button size="sm" variant="ghost" onClick={() => setConfirmRemove(true)}>
                <Trash2 className="size-4" aria-hidden />
                Remove key
              </Button>
            </div>
          )}

          <form onSubmit={submit} noValidate className="space-y-4" aria-label="Your AI model">
            <div className="grid grid-cols-1 gap-3">
              <Field label="Provider">
                {({ id, describedBy }) => (
                  <Select id={id} aria-describedby={describedBy} value={draft.providerId} onChange={(e) => patch({ providerId: e.target.value as AiProviderId })}>
                    {PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>{p.label}</option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>

            {draft.providerId === 'openai-compatible' && (
              <Field label="Server address" error={errors.baseUrl} hint="Works with OpenRouter, Groq, Together, a local Ollama or LM Studio, and anything that speaks the OpenAI chat format. The server must allow requests from a web page.">
                {({ id, describedBy, invalid }) => (
                  <Input id={id} aria-describedby={describedBy} aria-invalid={invalid} placeholder="https://openrouter.ai/api/v1" value={draft.baseUrl} onChange={(e) => patch({ baseUrl: e.target.value })} autoComplete="off" spellCheck={false} inputMode="url" />
                )}
              </Field>
            )}
            {draft.providerId === 'openai-compatible' && (
              <div className="-mt-1 space-y-1.5">
                <div className="flex flex-wrap gap-1.5" role="group" aria-label="Server presets">
                  {SERVER_PRESETS.map((p) => (
                    <Button key={p.label} type="button" size="sm" variant={draft.baseUrl.trim() === p.baseUrl ? 'primary' : 'ghost'} onClick={() => patch({ baseUrl: p.baseUrl })}>
                      {p.label}
                    </Button>
                  ))}
                </div>
                {SERVER_PRESETS.find((p) => p.baseUrl === draft.baseUrl.trim())?.note && (
                  <p className="px-1 text-xs text-ink-3">{SERVER_PRESETS.find((p) => p.baseUrl === draft.baseUrl.trim())?.note}</p>
                )}
              </div>
            )}

            <Field label="API key" error={errors.key} hint={ai.hasKey ? `Saved as ${ai.keyHint}. Leave this empty to keep it, or paste a new one to replace it.` : info.keyHint}>
              {({ id, describedBy, invalid }) => (
                <div className="relative">
                  <KeyRound className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-ink-3" aria-hidden />
                  <Input
                    id={id}
                    type="password"
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    className="pl-10"
                    value={key}
                    onChange={(e) => {
                      setKey(e.target.value);
                      setTest({ state: 'idle' });
                    }}
                    placeholder={ai.hasKey ? '••••••••••••' : 'Paste your key'}
                    autoComplete="new-password"
                    data-1p-ignore
                    data-lpignore="true"
                    spellCheck={false}
                  />
                </div>
              )}
            </Field>

            <div className="space-y-2" data-testid="model-picker">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="px-1 text-[13px] font-medium text-ink-2">Model</p>
                <Segmented<'auto' | 'manual'>
                  label="How the model is chosen"
                  value={draft.autoModel ? 'auto' : 'manual'}
                  onChange={setMode}
                  options={[
                    { value: 'auto', label: 'Auto (best for tracking)' },
                    { value: 'manual', label: 'Choose myself' },
                  ]}
                />
              </div>

              {listing && listing.best && !typing ? (
                <Field label="Detected models" error={errors.model} hint={undefined}>
                  {({ id, describedBy, invalid }) => (
                    <Select
                      id={id}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      value={draft.model}
                      onChange={(e) => {
                        const v = e.target.value;
                        patch({ model: v, autoModel: v === listing.best?.id ? draft.autoModel : false });
                      }}
                    >
                      {pickedHidden && <option value={draft.model}>{draft.model} (current)</option>}
                      {shown.map((m, i) => (
                        <option key={m.id} value={m.id}>
                          {i === 0 ? '★ ' : ''}{m.id}{m.label !== m.id ? `  (${m.label})` : ''}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
              ) : (
                <Field
                  label={listing ? 'Model name' : 'Model'}
                  error={errors.model}
                  hint={draft.autoModel && detect.state !== 'error' ? undefined : `Copy the exact model name from ${info.label}.`}
                >
                  {({ id, describedBy, invalid }) => (
                    <Input
                      id={id}
                      aria-describedby={describedBy}
                      aria-invalid={invalid}
                      value={draft.model}
                      onChange={(e) => patch({ model: e.target.value, autoModel: false })}
                      placeholder={draft.autoModel ? 'Detected automatically once your key is added' : 'Model name'}
                      autoComplete="off"
                      spellCheck={false}
                      autoCapitalize="none"
                    />
                  )}
                </Field>
              )}

              <div aria-live="polite" className="space-y-1 px-1 text-[13px]" data-testid="model-detect-status">
                {detect.state === 'loading' && (
                  <p className="flex items-center gap-1.5 text-ink-2">
                    <RefreshCw className="size-3.5 animate-spin" aria-hidden />
                    Detecting the models your key can use…
                  </p>
                )}
                {detect.state === 'error' && (
                  <p role="alert" className="text-danger">
                    Couldn&apos;t detect models. {detect.message} You can still type a model name.
                  </p>
                )}
                {detect.state === 'idle' && !listing && (
                  <p className="text-ink-3">{draft.autoModel ? 'Add your key and the best model for budgeting and bulking is picked for you.' : 'Add your key to list the models it can use.'}</p>
                )}
                {listing && detect.state === 'idle' && best && (
                  <>
                    <p className="flex flex-wrap items-center gap-1.5 text-ink-2">
                      <Sparkles className="size-3.5 text-primary" aria-hidden />
                      {draft.autoModel ? (
                        <>
                          Picked automatically: <span className="font-medium text-ink">{draft.model}</span>
                        </>
                      ) : picked && picked.id === best.id ? (
                        <>
                          This is the recommended model.
                        </>
                      ) : (
                        <>
                          Recommended: <button type="button" className="font-medium text-primary underline-offset-2 hover:underline" onClick={() => patch({ model: best.id })}>{best.id}</button>
                        </>
                      )}
                    </p>
                    {picked && picked.reasons.length > 0 && <p className="text-ink-3">Why: {picked.reasons.join(' · ')}.</p>}
                    <p className="text-ink-3">
                      {listing.models.length} usable of {listing.totalCount} models
                      {listing.hiddenCount > 0 ? ` (${listing.hiddenCount} hidden: embeddings, image, audio, safety or no tool calling)` : ''}.
                    </p>
                  </>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button type="button" size="sm" onClick={() => setDetectNonce((n) => n + 1)} disabled={detect.state === 'loading' || (!key.trim() && !ai.hasKey)}>
                  <RefreshCw className="size-4" aria-hidden />
                  Detect models
                </Button>
                {listing && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setTyping((t) => !t)}>
                    {typing ? 'Pick from the list' : 'Type a name instead'}
                  </Button>
                )}
              </div>
            </div>

            <div>
              <p className="mb-1.5 px-1 text-[13px] font-medium text-ink-2">Where to keep the key</p>
              <Segmented<KeyStorage>
                label="Where to keep the key"
                value={draft.storage}
                onChange={(v) => patch({ storage: v })}
                options={[
                  { value: 'session', label: 'This tab only' },
                  { value: 'device', label: 'This device' },
                ]}
              />
              <p className="mt-1.5 px-1 text-xs text-ink-3">
                {draft.storage === 'session' ? 'Forgotten when you close the tab. Safest, but you re-enter it next time.' : 'Stays in this browser until you remove it. Convenient, but anyone using this browser profile can read it.'}
              </p>
            </div>

            <Field label="Standing notes" optional error={errors.notes} hint={`Anything you'd otherwise repeat. Up to ${NOTES_MAX} characters. These add detail; they can't change the built-in rules.`}>
              {({ id, describedBy, invalid }) => (
                <>
                  <Textarea
                    id={id}
                    aria-describedby={describedBy}
                    aria-invalid={invalid}
                    rows={3}
                    maxLength={NOTES_MAX + 200}
                    placeholder={'e.g. "Mess lunch = 2 roti, dal, rice. Uber and auto are transport. I weigh in on Sunday mornings."'}
                    value={draft.notes}
                    onChange={(e) => patch({ notes: e.target.value })}
                  />
                  <p className="mt-1 px-1 text-right text-[11px] text-ink-3 tnum">{draft.notes.length}/{NOTES_MAX}</p>
                </>
              )}
            </Field>

            <div className="flex flex-wrap items-center gap-2">
              <Button type="submit" variant="primary">
                <Zap className="size-4" aria-hidden />
                {active ? 'Save changes' : 'Save and use this model'}
              </Button>
              <Button type="button" onClick={() => void runTest()} loading={test.state === 'running'}>
                Test connection
              </Button>
            </div>
            <div aria-live="polite" className="min-h-5 text-sm">
              {test.state === 'ok' && (
                <p className="flex items-center gap-1.5 text-success">
                  <CheckCircle2 className="size-4" aria-hidden />
                  Connected to {test.model} in {test.ms} ms.{test.switched ? ' Your first choice was not available, so the next best model was selected.' : ''} (That used a tiny request on your account.)
                </p>
              )}
              {test.state === 'error' && (
                <p role="alert" className="text-danger">
                  {test.message}
                </p>
              )}
            </div>
          </form>

          <div className="space-y-3 rounded-2xl bg-sunken px-4 py-3.5 text-[13px] text-ink-2">
            <p className="flex items-center gap-2 font-medium text-ink">
              <Lock className="size-4 text-ink-3" aria-hidden />
              Already set up for you
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>Built-in instructions: it only handles meals, calories, protein, weight, spending and income in ₹, and politely declines anything else.</li>
              <li>It can only use eight tools: log a meal, expense/income or weight, fetch totals, search your records, and correct a record. It can't delete anything.</li>
              <li>It asks instead of guessing a missing amount or weight, and leaves unknown nutrition blank rather than inventing it.</li>
              <li>In Auto mode the app looks up which models your key can use and picks the best one for this job: reliable tool calling, quick replies, sensible price. It re-checks once per session and switches only if your model disappears or a clearly better one appears.</li>
              <li>Your targets, timezone and today's date are sent with every message, so you never explain them.</li>
            </ul>
          </div>

          <div className="flex gap-3 rounded-2xl bg-warning-soft px-4 py-3.5 text-[13px] text-warning">
            <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <div className="space-y-1.5">
              <p className="font-semibold">Read this about keys</p>
              <p>Your key is kept in this browser and used to call your provider directly from this page. It isn't sent anywhere else, but anyone who can use this browser profile, its developer tools, or an extension with access to this site could read it.</p>
              <p>The key itself can't be limited to budgeting and bulking: the limit is in what this app lets the model do, and it is enforced by instructions plus a fixed tool list, not by your provider. Use a dedicated key with a low spend limit, and revoke it at your provider if you ever doubt it.</p>
            </div>
          </div>
        </CardBody>
      </Card>

      <ConfirmDialog
        open={confirmRemove}
        title="Remove your API key?"
        description="The key is deleted from this browser and chat goes back to the built-in demo assistant. Your records and notes stay. You can revoke the key at your provider too."
        confirmLabel="Remove key"
        onConfirm={() => {
          ai.removeKey();
          setConfirmRemove(false);
          setTest({ state: 'idle' });
          toast({ title: 'Key removed', tone: 'success' });
        }}
        onClose={() => setConfirmRemove(false)}
      />
    </div>
  );
}
