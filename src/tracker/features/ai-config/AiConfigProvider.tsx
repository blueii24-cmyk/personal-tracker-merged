import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useToast } from '@/tracker/components/ui/Toast';
import { chooseModel, fetchModels } from '@/tracker/lib/ai/byok/models';
import {
  baseUrlError, clearKey, configError, initKeyStore, loadConfig, maskKey, onKeyStoreError, readKey, saveConfig, writeKey,
  type ByokConfig,
} from '@/tracker/lib/ai/byok/config';

interface AiConfigApi {
  config: ByokConfig;
  hasKey: boolean;
  /** Masked, e.g. "sk-…a1b2". Never the key itself. */
  keyHint: string | null;
  /** The user's own model answers chat: switched on, key present, settings valid. */
  active: boolean;
  /** Persist settings. Pass `newKey` to replace the key; omit to keep the saved one. Returns an error message on failure. */
  save: (next: ByokConfig, newKey?: string) => string | null;
  setEnabled: (on: boolean) => void;
  removeKey: () => void;
  /** Read at send time so the key isn't held in React state. */
  getKey: () => string;
}

const Ctx = createContext<AiConfigApi | null>(null);

export function AiConfigProvider({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<ByokConfig>(loadConfig);
  const [keyVersion, setKeyVersion] = useState(0);

  const { toast } = useToast();
  const configRef = useRef(config);
  useEffect(() => {
    configRef.current = config;
  }, [config]);
  const checkedFor = useRef('');

  // Android: bring the Keystore-protected key into memory once at start-up.
  useEffect(() => {
    onKeyStoreError(() => toast({ title: "Couldn't use secure key storage", description: 'Your API key may not be saved. Add it again in Settings → AI assistant.', tone: 'error' }));
    let live = true;
    initKeyStore().then((changed) => {
      if (live && changed) setKeyVersion((v) => v + 1);
    });
    return () => {
      live = false;
      onKeyStoreError(null);
    };
  }, [toast]);

  const key = useMemo(() => readKey(), [keyVersion]); // eslint-disable-line react-hooks/exhaustive-deps
  const hasKey = key.length > 0;

  // Auto mode: once per session (and whenever the provider, server or key changes), look at what the key
  // can use now. Switch only if the current model is gone or a clearly better one has appeared.
  // A failure here is silent: the model that was already saved keeps working.
  const { enabled, autoModel, providerId, baseUrl } = config;
  useEffect(() => {
    if (!enabled || !autoModel || !hasKey) return;
    if (providerId === 'openai-compatible' && baseUrlError(baseUrl)) return;
    const signature = `${providerId}|${baseUrl}|${keyVersion}`;
    if (checkedFor.current === signature) return;
    const ctrl = new AbortController();
    fetchModels({ providerId, baseUrl }, readKey(), ctrl.signal)
      .then((listing) => {
        checkedFor.current = signature;
        const current = configRef.current;
        if (!current.autoModel || current.providerId !== providerId || current.baseUrl !== baseUrl) return;
        const pick = chooseModel(current.model, listing);
        if (!pick.changed) return;
        const next = { ...current, model: pick.model };
        saveConfig(next);
        setConfig(next);
        toast({ title: 'Model updated automatically', description: pick.reason, tone: 'success' });
      })
      .catch(() => undefined);
    return () => ctrl.abort();
  }, [enabled, autoModel, providerId, baseUrl, hasKey, keyVersion, toast]);

  const active = config.enabled && hasKey && Object.keys(configError(config)).length === 0;

  const save = useCallback((next: ByokConfig, newKey?: string): string | null => {
    const clean: ByokConfig = { ...next, model: next.model.trim(), baseUrl: next.baseUrl.trim(), notes: next.notes.trim() };
    if (newKey !== undefined && newKey.trim()) {
      if (!writeKey(newKey, clean.storage)) return "This device wouldn't let the app store the key. Check that app storage isn't blocked.";
    } else if (readKey()) {
      // Moving an existing key between "this tab" and "this device".
      const existing = readKey();
      if (!writeKey(existing, clean.storage)) return "This device wouldn't let the app store the key. Check that app storage isn't blocked.";
    }
    saveConfig(clean);
    setConfig(clean);
    setKeyVersion((v) => v + 1);
    return null;
  }, []);

  const setEnabled = useCallback((on: boolean) => {
    setConfig((c) => {
      const next = { ...c, enabled: on };
      saveConfig(next);
      return next;
    });
  }, []);

  const removeKey = useCallback(() => {
    clearKey();
    setConfig((c) => {
      const next = { ...c, enabled: false };
      saveConfig(next);
      return next;
    });
    setKeyVersion((v) => v + 1);
  }, []);

  const value = useMemo<AiConfigApi>(
    () => ({ config, hasKey, keyHint: hasKey ? maskKey(key) : null, active, save, setEnabled, removeKey, getKey: readKey }),
    [config, hasKey, key, active, save, setEnabled, removeKey],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAiConfig(): AiConfigApi {
  const v = useContext(Ctx);
  if (!v) throw new Error('useAiConfig must be used inside <AiConfigProvider>');
  return v;
}
