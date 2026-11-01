import { TrackerError } from '@/tracker/lib/api/errors';
import type { AiProviderAdapter, AiProviderId } from '../provider';
import { AnthropicAdapter } from './anthropic';
import { GeminiAdapter } from './gemini';
import { normalizeBaseUrl, OPENAI_BASE_URL, OpenAiAdapter } from './openai';

export type KeyStorage = 'session' | 'device';

export interface ByokConfig {
  /** When false the saved key stays put but the demo assistant answers. */
  enabled: boolean;
  providerId: AiProviderId;
  model: string;
  /** When true the app detects the models your key can use and keeps the best one for this job selected. */
  autoModel: boolean;
  /** Only used for `openai-compatible`. */
  baseUrl: string;
  /** The user's own standing instructions, added after the fixed rules. Never replaces them. */
  notes: string;
  /** Where the key lives: this tab only, or this browser until removed. */
  storage: KeyStorage;
}

export const NOTES_MAX = 800;
export const DEFAULT_CONFIG: ByokConfig = { enabled: false, providerId: 'openai', model: '', autoModel: true, baseUrl: '', notes: '', storage: 'session' };

export interface ProviderInfo {
  id: AiProviderId;
  label: string;
  modelExample: string;
  keyHint: string;
  keyPrefixHint?: string;
}
export const PROVIDERS: ProviderInfo[] = [
  { id: 'openai', label: 'OpenAI', modelExample: 'a model id from your OpenAI account', keyHint: 'Starts with sk-', keyPrefixHint: 'sk-' },
  { id: 'anthropic', label: 'Anthropic (Claude)', modelExample: 'a Claude model id', keyHint: 'Starts with sk-ant-', keyPrefixHint: 'sk-ant-' },
  { id: 'gemini', label: 'Google Gemini', modelExample: 'a Gemini model id', keyHint: 'Starts with AIza (Google AI Studio)', keyPrefixHint: 'AIza' },
  { id: 'openai-compatible', label: 'Other (OpenAI-compatible)', modelExample: 'the model name your server expects', keyHint: 'Whatever the service gave you. Leave a placeholder for local servers that need none.' },
];
export const providerInfo = (id: AiProviderId): ProviderInfo => PROVIDERS.find((p) => p.id === id)!;

/** One-click server addresses for the "Other (OpenAI-compatible)" provider. */
export interface ServerPreset {
  label: string;
  baseUrl: string;
  /** Shown under the presets when picked. */
  note?: string;
}
export const SERVER_PRESETS: ServerPreset[] = [
  { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', note: 'Hosts NVIDIA Nemotron, Claude, GPT, Gemini, Llama and more behind one key, and allows browser requests.' },
  { label: 'Groq', baseUrl: 'https://api.groq.com/openai/v1' },
  { label: 'Together', baseUrl: 'https://api.together.xyz/v1' },
  { label: 'NVIDIA NIM', baseUrl: 'https://integrate.api.nvidia.com/v1', note: "NVIDIA's own API does not allow requests from a web page (CORS), so detection and chat will fail here. To use Nemotron, pick OpenRouter instead." },
  { label: 'Ollama (this device)', baseUrl: 'http://localhost:11434/v1', note: 'Start Ollama with OLLAMA_ORIGINS set to allow this page.' },
];

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/** Returns an error message, or null when the address is acceptable. Plain http is allowed only for a server on this device. */
export function baseUrlError(raw: string): string | null {
  const value = raw.trim();
  if (!value) return 'Enter the server address, for example https://openrouter.ai/api/v1';
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return 'That is not a valid address. Include https://';
  }
  if (url.username || url.password) return "Don't put credentials in the address.";
  if (url.protocol === 'https:') return null;
  if (url.protocol === 'http:' && LOCAL_HOSTS.has(url.hostname)) return null;
  return 'Use an https:// address. Plain http is only allowed for a server on this device (localhost).';
}

export function configError(c: ByokConfig): Partial<Record<'model' | 'baseUrl' | 'notes', string>> {
  const e: Partial<Record<'model' | 'baseUrl' | 'notes', string>> = {};
  if (!c.model.trim()) e.model = c.autoModel ? 'No model picked yet. Add your key and the best one will be detected.' : 'Enter the model name you want to use.';
  else if (c.model.trim().length > 120 || /\s/.test(c.model.trim())) e.model = 'Model names have no spaces. Copy it exactly from your provider.';
  if (c.providerId === 'openai-compatible') {
    const m = baseUrlError(c.baseUrl);
    if (m) e.baseUrl = m;
  }
  if (c.notes.length > NOTES_MAX) e.notes = `Keep your notes under ${NOTES_MAX} characters.`;
  return e;
}

export function createAdapter(config: Pick<ByokConfig, 'providerId' | 'baseUrl'>, apiKey: string): AiProviderAdapter {
  const key = apiKey.trim();
  if (!key) throw new TrackerError('AI_KEY_MISSING', 'No API key is saved. Add one in Settings → AI assistant.', { retryable: false });
  switch (config.providerId) {
    case 'openai':
      return new OpenAiAdapter(key, OPENAI_BASE_URL, false);
    case 'anthropic':
      return new AnthropicAdapter(key);
    case 'gemini':
      return new GeminiAdapter(key);
    case 'openai-compatible': {
      const err = baseUrlError(config.baseUrl);
      if (err) throw new TrackerError('INVALID_REQUEST', err, { retryable: false });
      return new OpenAiAdapter(key, normalizeBaseUrl(config.baseUrl), true);
    }
  }
}

/* ------------------------------- storage -------------------------------- */

const CONFIG_KEY = 'pt.ai.config.v1';
const KEY_KEY = 'pt.ai.key.v1';

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function loadConfig(): ByokConfig {
  return safe(() => {
    const raw = localStorage.getItem(CONFIG_KEY);
    if (!raw) return { ...DEFAULT_CONFIG };
    const p = JSON.parse(raw) as Partial<ByokConfig>;
    const valid = PROVIDERS.some((x) => x.id === p.providerId);
    return {
      enabled: p.enabled === true,
      providerId: valid ? (p.providerId as AiProviderId) : 'openai',
      model: typeof p.model === 'string' ? p.model : '',
      // Settings saved before auto-detect existed keep their hand-typed model.
      autoModel: typeof p.autoModel === 'boolean' ? p.autoModel : !(typeof p.model === 'string' && p.model.trim()),
      baseUrl: typeof p.baseUrl === 'string' ? p.baseUrl : '',
      notes: typeof p.notes === 'string' ? p.notes.slice(0, NOTES_MAX) : '',
      storage: p.storage === 'device' ? 'device' : 'session',
    };
  }, { ...DEFAULT_CONFIG });
}
/** The config never contains the key. */
export function saveConfig(c: ByokConfig): void {
  safe(() => localStorage.setItem(CONFIG_KEY, JSON.stringify(c)), undefined);
}

/** Reads the key from wherever it was saved. Returns '' when there is none. */
export function readKey(): string {
  return safe(() => sessionStorage.getItem(KEY_KEY) ?? localStorage.getItem(KEY_KEY) ?? '', '');
}
/** Writes the key to exactly one store and clears the other. Returns false if the browser refused. */
export function writeKey(key: string, where: KeyStorage): boolean {
  const target = where === 'device' ? localStorage : sessionStorage;
  const other = where === 'device' ? sessionStorage : localStorage;
  try {
    other.removeItem(KEY_KEY);
    target.setItem(KEY_KEY, key.trim());
    return true;
  } catch {
    return false;
  }
}
export function clearKey(): void {
  safe(() => sessionStorage.removeItem(KEY_KEY), undefined);
  safe(() => localStorage.removeItem(KEY_KEY), undefined);
}

/** "sk-…a1b2" style hint so the user can recognise which key is saved without showing it. */
export function maskKey(key: string): string {
  const k = key.trim();
  if (k.length <= 8) return '••••';
  return `${k.slice(0, 3)}…${k.slice(-4)}`;
}
