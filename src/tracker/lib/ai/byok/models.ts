/**
 * Model discovery and "best model for this app" selection.
 *
 * 1. `fetchModels` asks the provider which models this key can use (OpenAI, Anthropic, Gemini, or any
 *    OpenAI-compatible server such as OpenRouter, Groq or a local Ollama).
 * 2. `rankModels` throws away models that can't do this job (embeddings, image/audio/video, moderation,
 *    models that explicitly lack tool calling) and scores the rest.
 * 3. `chooseModel` picks the winner, and only switches away from the model you already use when the
 *    current one has disappeared or a clearly better one is available.
 *
 * What "best" means here: the assistant does short chats with tool calls (log a meal, add an expense,
 * fetch totals). So it favours reliable tool calling and instruction following at a sensible speed and
 * price, and avoids slow reasoning models, tiny models, code/vision/safety specialists and
 * very expensive ones. The scoring tables below are plain data: edit them as models come and go.
 */
import { TrackerError } from '@/tracker/lib/api/errors';
import type { AiProviderId } from '../provider';
import { ANTHROPIC_URL } from './anthropic';
import { GEMINI_BASE_URL } from './gemini';
import { getJson } from './http';
import { normalizeBaseUrl, OPENAI_BASE_URL } from './openai';

/* --------------------------------- types --------------------------------- */

export interface RawModel {
  id: string;
  name?: string;
  /** Unix seconds, used only as a tie-breaker (newer wins). */
  created?: number;
  contextTokens?: number;
  /** `true`/`false` only when the provider says so; `null` when unknown. */
  supportsTools: boolean | null;
  /** Only set for Gemini ("generateContent" etc.). */
  methods?: string[];
  outputModalities?: string[];
  /** USD per million input tokens, when the provider publishes it. */
  promptPricePerM?: number;
}

export interface DetectedModel {
  id: string;
  label: string;
  score: number;
  /** Short plain-language reasons shown next to the recommendation. */
  reasons: string[];
  supportsTools: boolean | null;
  contextTokens?: number;
}

export interface ModelListing {
  /** Usable models, best first. */
  models: DetectedModel[];
  best: DetectedModel | null;
  /** How many listed models were left out because they can't do this job. */
  hiddenCount: number;
  /** Everything the provider listed. */
  totalCount: number;
}

/* ------------------------------ fetch (per provider) ------------------------------ */

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const str = (v: unknown): string | undefined => (typeof v === 'string' && v.trim() ? v.trim() : undefined);
const numOf = (v: unknown): number | undefined => {
  const n = typeof v === 'string' ? Number(v) : v;
  return typeof n === 'number' && Number.isFinite(n) ? n : undefined;
};
const strList = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined);

/** Reads `{data:[...]}`, `{models:[...]}` or a bare array, which together cover every common server. */
function listOf(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (isObj(body)) {
    if (Array.isArray(body.data)) return body.data;
    if (Array.isArray(body.models)) return body.models;
  }
  return [];
}

export function parseOpenAiModels(body: unknown): RawModel[] {
  const out: RawModel[] = [];
  for (const item of listOf(body)) {
    const m = typeof item === 'string' ? { id: item } : item;
    if (!isObj(m)) continue;
    const id = str(m.id) ?? str(m.name) ?? str(m.model);
    if (!id) continue;
    const params = strList(m.supported_parameters);
    const arch = isObj(m.architecture) ? m.architecture : undefined;
    const pricing = isObj(m.pricing) ? m.pricing : undefined;
    const prompt = numOf(pricing?.prompt);
    out.push({
      id,
      name: str(m.name) && str(m.name) !== id ? str(m.name) : undefined,
      created: numOf(m.created),
      contextTokens: numOf(m.context_length) ?? numOf(m.context_window) ?? numOf(m.max_context_length),
      // OpenRouter publishes the parameters each model accepts; "tools" is the one that matters here.
      supportsTools: params ? params.includes('tools') : null,
      outputModalities: strList(arch?.output_modalities),
      promptPricePerM: prompt !== undefined ? prompt * 1_000_000 : undefined,
    });
  }
  return out;
}

export function parseAnthropicModels(body: unknown): RawModel[] {
  const out: RawModel[] = [];
  for (const m of listOf(body)) {
    if (!isObj(m)) continue;
    const id = str(m.id);
    if (!id) continue;
    const created = str(m.created_at) ? Date.parse(String(m.created_at)) / 1000 : undefined;
    out.push({ id, name: str(m.display_name), created: Number.isFinite(created) ? created : undefined, supportsTools: true });
  }
  return out;
}

export function parseGeminiModels(body: unknown): RawModel[] {
  const out: RawModel[] = [];
  for (const m of listOf(body)) {
    if (!isObj(m)) continue;
    const id = str(m.name)?.replace(/^models\//, '');
    if (!id) continue;
    out.push({
      id,
      name: str(m.displayName),
      contextTokens: numOf(m.inputTokenLimit),
      methods: strList(m.supportedGenerationMethods),
      supportsTools: null,
    });
  }
  return out;
}

export async function fetchRawModels(
  config: { providerId: AiProviderId; baseUrl: string },
  apiKey: string,
  signal?: AbortSignal,
): Promise<RawModel[]> {
  const key = apiKey.trim();
  if (!key) throw new TrackerError('AI_KEY_MISSING', 'Add your API key first, then models can be detected.', { retryable: false });
  const common = { apiKey: key, signal, timeoutMs: 20_000 };
  switch (config.providerId) {
    case 'openai': {
      const { data } = await getJson<unknown>({ ...common, url: `${OPENAI_BASE_URL}/models`, headers: { authorization: `Bearer ${key}` }, providerLabel: 'OpenAI' });
      return parseOpenAiModels(data);
    }
    case 'openai-compatible': {
      const { data } = await getJson<unknown>({ ...common, url: `${normalizeBaseUrl(config.baseUrl)}/models`, headers: { authorization: `Bearer ${key}` }, providerLabel: 'Your server' });
      return parseOpenAiModels(data);
    }
    case 'anthropic': {
      const { data } = await getJson<unknown>({
        ...common,
        url: `${ANTHROPIC_URL.replace(/\/messages$/, '/models')}?limit=1000`,
        headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' },
        providerLabel: 'Anthropic',
      });
      return parseAnthropicModels(data);
    }
    case 'gemini': {
      const { data } = await getJson<unknown>({ ...common, url: `${GEMINI_BASE_URL}/models?pageSize=1000`, headers: { 'x-goog-api-key': key }, providerLabel: 'Google Gemini' });
      return parseGeminiModels(data);
    }
  }
}

/* --------------------------------- ranking --------------------------------- */

/** Models that can't act as a chat assistant with tools. These are hidden, never recommended. */
const NOT_A_CHAT_MODEL =
  /embed|rerank|retriev|whisper|tts|speech|audio|realtime|transcri|dall-?e|image|imagen|veo|sora|lyria|video|diffusion|flux|moderation|guard|safety|safeguard|reward|classif|aqa|learnlm|robotics|computer-use|deep-research|search-preview|-live\b|davinci|babbage|codex|\bocr\b|\bparse\b|\bclip\b|nv-?embed/;

interface Rule {
  test: RegExp;
  base: number;
  why: string;
}

/** First matching rule sets the starting score. Order matters: specific before general. */
const FAMILY_RULES: Rule[] = [
  { test: /nemotron.*(super|lightning)|(super|lightning).*nemotron/, base: 92, why: 'Nemotron Super/Lightning: built for agent-style tool use' },
  { test: /nemotron.*ultra/, base: 80, why: 'Nemotron Ultra: strong but large and slower' },
  { test: /nemotron.*nano/, base: 78, why: 'Nemotron Nano: fast and light' },
  { test: /nemotron/, base: 74, why: 'NVIDIA Nemotron' },

  { test: /claude.*sonnet/, base: 90, why: 'Claude Sonnet: reliable tool use at a balanced speed and price' },
  { test: /claude.*haiku/, base: 86, why: 'Claude Haiku: fast and cheap' },
  { test: /claude.*opus/, base: 80, why: 'Claude Opus: very capable but slower and pricier than needed' },
  { test: /claude/, base: 60, why: 'Claude' },

  { test: /gpt-5.*nano/, base: 70, why: 'Nano size: fastest, least reliable with tools' },
  { test: /gpt-5.*mini/, base: 90, why: 'GPT-5 mini: strong tool use, fast and cheap' },
  { test: /gpt-5/, base: 88, why: 'GPT-5: very capable' },
  { test: /gpt-4\.1.*nano/, base: 66, why: 'Nano size: fastest, least reliable with tools' },
  { test: /gpt-4\.1.*mini/, base: 86, why: 'GPT-4.1 mini: fast, good tool use' },
  { test: /gpt-4\.1/, base: 84, why: 'GPT-4.1: good instruction following' },
  { test: /gpt-4o.*mini/, base: 78, why: 'GPT-4o mini: fast and cheap' },
  { test: /gpt-4o/, base: 80, why: 'GPT-4o' },
  { test: /gpt-oss.*120b/, base: 82, why: 'Open-weight GPT-OSS 120B' },
  { test: /gpt-oss/, base: 70, why: 'Open-weight GPT-OSS' },
  { test: /gpt-4-turbo|gpt-4-\d{4}/, base: 66, why: 'Older GPT-4' },
  { test: /gpt-3\.5/, base: 45, why: 'Older and weaker at tool calls' },
  { test: /(^|[/-])o\d(-|$)/, base: 70, why: 'Reasoning model: accurate but slow for quick logging' },

  { test: /gemini.*flash-lite|gemini.*lite/, base: 76, why: 'Flash-Lite: fastest, a little less reliable' },
  { test: /gemini.*flash/, base: 90, why: 'Gemini Flash: fast with solid tool use' },
  { test: /gemini.*pro/, base: 86, why: 'Gemini Pro: very capable but slower' },
  { test: /gemini/, base: 60, why: 'Gemini' },

  { test: /grok/, base: 78, why: 'Grok' },
  { test: /llama.*(70b|90b|405b)|llama-?4/, base: 76, why: 'Large Llama: solid tool use' },
  { test: /llama/, base: 60, why: 'Llama' },
  { test: /qwen.*(235b|72b|32b|max|plus)/, base: 76, why: 'Large Qwen: solid tool use' },
  { test: /qwen/, base: 66, why: 'Qwen' },
  { test: /deepseek/, base: 72, why: 'DeepSeek' },
  { test: /mistral-(large|medium)|mixtral-8x22b/, base: 76, why: 'Large Mistral: solid tool use' },
  { test: /mistral|mixtral/, base: 64, why: 'Mistral' },
  { test: /glm|kimi|minimax/, base: 74, why: 'Strong open model' },
  { test: /command-r/, base: 66, why: 'Command R' },
];

const DEFAULT_BASE = 50;

/** Removes dates, sizes and tags so the first remaining number is the model generation (4.1, 3.5, 2.5, ...). */
export function modelGeneration(id: string): number {
  const s = (id.split('/').pop() ?? id)
    .toLowerCase()
    .replace(/:.*$/, '')
    .replace(/\d{4}-\d{2}-\d{2}|\d{8}|\d{6}|-\d{4}(?!\d)/g, '')
    .replace(/\d+x\d+(\.\d+)?b|a?\d+(\.\d+)?[bkm]\b|-a\d+b/g, '');
  const m = s.match(/(\d+)(?:\.(\d+)|-(\d{1,2})(?!\d))?/);
  if (!m) return 0;
  const major = Number(m[1]);
  const minor = m[2] ?? m[3];
  return Math.min(12, major + (minor ? Number(minor) / 10 : 0));
}

/** Parameter count in billions when the id says so (e.g. "49b", "120b-a12b" -> 120). */
export function modelSizeB(id: string): number | null {
  const s = id.toLowerCase();
  const total = s.match(/(\d+(?:\.\d+)?)b(?![a-z])/);
  return total ? Number(total[1]) : null;
}

function prettyLabel(raw: RawModel): string {
  return raw.name && raw.name.length <= 80 ? raw.name : raw.id;
}

export function scoreModel(raw: RawModel, allIds: ReadonlySet<string>, providerId: AiProviderId): { score: number; reasons: string[]; reject?: string; /** Index of the matched family rule (-1 = none). */ group: number; gen: number } {
  const id = raw.id.toLowerCase();
  const reasons: string[] = [];

  if (/:(batch|online)$/.test(id)) return { score: 0, reasons, reject: 'Not an interactive variant', group: -1, gen: 0 };
  if (NOT_A_CHAT_MODEL.test(id)) return { score: 0, reasons, reject: 'Not a chat model', group: -1, gen: 0 };
  // OpenAI's completion-only and Responses-API-only models don't work with chat completions.
  if (providerId === 'openai' && /-instruct$|-pro$/.test(id)) return { score: 0, reasons, reject: 'Not available for chat', group: -1, gen: 0 };
  if (providerId === 'gemini') {
    if (raw.methods && !raw.methods.includes('generateContent')) return { score: 0, reasons, reject: 'Cannot generate text', group: -1, gen: 0 };
    if (/gemma/.test(id)) return { score: 0, reasons, reject: 'No tool calling', group: -1, gen: 0 };
  }
  if (raw.outputModalities && raw.outputModalities.length > 0 && !raw.outputModalities.every((m) => m === 'text')) return { score: 0, reasons, reject: 'Does not output text only', group: -1, gen: 0 };
  if (raw.supportsTools === false) return { score: 0, reasons, reject: 'No tool calling', group: -1, gen: 0 };

  const group = FAMILY_RULES.findIndex((r) => r.test.test(id));
  const rule = group >= 0 ? FAMILY_RULES[group] : undefined;
  let score = rule ? rule.base : DEFAULT_BASE;
  reasons.push(rule ? rule.why : 'Unrecognised model, scored cautiously');

  if (raw.supportsTools === true) {
    score += 12;
    reasons.push('Supports tool calls');
  }

  const gen = modelGeneration(id);

  const size = modelSizeB(id);
  if (size !== null) {
    if (size < 8) {
      score -= 25;
      reasons.push('Very small: often unreliable with tools');
    } else if (size < 20) score -= 8;
    else if (size <= 150) score += 4;
    else if (size > 300) {
      score -= 10;
      reasons.push('Very large: slow for chat');
    }
  }

  if (/(^|[-/])(vl|vision|omni|multimodal)\b/.test(id)) score -= 8; // heavier than needed for text logging
  if (/coder|code(?!x)|math/.test(id)) score -= 20;
  if (/think|reason|-r1\b/.test(id) && !/non-?reason/.test(id)) {
    score -= 8;
    reasons.push('Reasoning model: slower replies');
  }
  if (/-pro\b/.test(id) && !/gemini/.test(id)) {
    score -= 8;
    reasons.push('Pro tier: slower and pricier than needed');
  }
  if (/preview|experimental|\bexp\b|beta/.test(id)) score -= 5;

  // Prefer the stable alias over a dated snapshot of the same model when both are listed.
  const undated = id.replace(/-?(\d{4}-\d{2}-\d{2}|\d{8})$/, '');
  if (undated !== id && allIds.has(undated)) score -= 6;

  if (raw.contextTokens !== undefined) {
    if (raw.contextTokens < 8_000) {
      score -= 20;
      reasons.push('Small context window');
    } else if (raw.contextTokens >= 128_000) score += 3;
  }

  if (raw.promptPricePerM !== undefined) {
    if (raw.promptPricePerM > 15) {
      score -= 12;
      reasons.push('Expensive per token');
    } else if (raw.promptPricePerM > 5) score -= 5;
    else if (raw.promptPricePerM === 0) score -= 2; // free tiers are usually rate-limited
  }
  if (/:free$/.test(id)) score -= 3;

  return { score, reasons: reasons.slice(0, 3), group, gen };
}

export function rankModels(raw: RawModel[], providerId: AiProviderId): ModelListing {
  const byId = new Map<string, RawModel>();
  for (const m of raw) if (!byId.has(m.id)) byId.set(m.id, m);
  const ids = new Set([...byId.keys()].map((i) => i.toLowerCase()));

  const results = [...byId.values()].map((m) => ({ m, r: scoreModel(m, ids, providerId) })).filter((x) => !x.r.reject);

  // Newer is better, but only when compared with models of the same family (so Sonnet 5 beats Sonnet 4,
  // without a high version number in one family outranking a different family).
  const newest = new Map<number, number>();
  for (const { r } of results) newest.set(r.group, Math.max(newest.get(r.group) ?? 0, r.gen));

  const scored: Array<{ d: DetectedModel; created: number }> = results.map(({ m, r }) => {
    const behind = r.gen > 0 ? Math.min(15, ((newest.get(r.group) ?? r.gen) - r.gen) * 5) : 0;
    const score = Math.round((r.score - behind) * 10) / 10;
    const reasons = behind >= 2.5 ? [...r.reasons.slice(0, 2), 'An older generation'] : r.reasons;
    return {
      d: { id: m.id, label: prettyLabel(m), score, reasons, supportsTools: m.supportsTools, contextTokens: m.contextTokens },
      created: m.created ?? 0,
    };
  });
  scored.sort((a, b) => b.d.score - a.d.score || b.created - a.created || a.d.id.localeCompare(b.d.id));
  const models = scored.map((s) => s.d);
  return { models, best: models[0] ?? null, hiddenCount: byId.size - models.length, totalCount: byId.size };
}

/** Fetch, filter and rank in one step. */
export async function fetchModels(config: { providerId: AiProviderId; baseUrl: string }, apiKey: string, signal?: AbortSignal): Promise<ModelListing> {
  const raw = await fetchRawModels(config, apiKey, signal);
  return rankModels(raw, config.providerId);
}

/* --------------------------------- choosing --------------------------------- */

/** A new model must beat the current one by this much before auto mode switches, so it doesn't flip-flop. */
export const SWITCH_MARGIN = 5;

export function chooseModel(current: string, listing: ModelListing): { model: string; changed: boolean; reason: string } {
  const best = listing.best;
  const cur = current.trim();
  if (!best) return { model: cur, changed: false, reason: 'No suitable models were found.' };
  if (!cur) return { model: best.id, changed: true, reason: `Picked ${best.id}.` };
  const existing = listing.models.find((m) => m.id === cur);
  if (!existing) {
    return { model: best.id, changed: true, reason: `${cur} is no longer available to this key, so ${best.id} was picked.` };
  }
  if (best.score - existing.score >= SWITCH_MARGIN) {
    return { model: best.id, changed: true, reason: `${best.id} is now a better fit than ${cur}.` };
  }
  return { model: cur, changed: false, reason: 'Already using a good model.' };
}
