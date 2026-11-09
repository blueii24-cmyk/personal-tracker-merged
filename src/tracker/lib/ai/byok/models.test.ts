import { afterEach, describe, expect, it, vi } from 'vitest';
import { TrackerError } from '@/tracker/lib/api/errors';
import { PROXY_MARK } from './bridged-hosts';
import { LLM_PROXY_PATH } from './llm-fetch';
import {
  chooseModel, fetchModels, modelGeneration, parseAnthropicModels, parseGeminiModels, parseOpenAiModels, rankModels, SWITCH_MARGIN,
  type RawModel,
} from './models';

const oa = (ids: string[]): RawModel[] => ids.map((id) => ({ id, supportsTools: null }));
const rankIds = (raw: RawModel[], p: Parameters<typeof rankModels>[1]) => rankModels(raw, p).models.map((m) => m.id);

describe('model generation parsing', () => {
  it.each([
    ['claude-sonnet-4-5-20250929', 4.5],
    ['claude-3-5-sonnet-20241022', 3.5],
    ['gpt-4.1-mini', 4.1],
    ['gemini-2.5-flash', 2.5],
    ['nvidia/nemotron-3.5-lightning:free', 3.5],
    ['meta/llama-3.1-70b-instruct', 3.1],
    ['mistralai/mistral-large-2407', 0],
    ['openai/gpt-oss-120b', 0],
  ])('%s -> %s', (id, gen) => expect(modelGeneration(id)).toBe(gen));
});

describe('OpenAI list', () => {
  it('hides non-chat models and prefers a mini over a legacy model', () => {
    const ids = rankIds(
      oa(['text-embedding-3-large', 'whisper-1', 'tts-1', 'dall-e-3', 'gpt-image-1', 'omni-moderation-latest', 'gpt-4o-realtime-preview', 'gpt-5-codex', 'o1-pro', 'gpt-3.5-turbo-instruct', 'gpt-3.5-turbo', 'gpt-4.1-mini', 'gpt-5-mini', 'gpt-4o']),
      'openai',
    );
    expect(ids).toEqual(['gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o', 'gpt-3.5-turbo']);
  });
  it('prefers the stable alias over a dated snapshot', () => {
    expect(rankIds(oa(['gpt-4.1-mini-2025-04-14', 'gpt-4.1-mini']), 'openai')[0]).toBe('gpt-4.1-mini');
  });
});

describe('Anthropic list', () => {
  it('picks the newest Sonnet over Haiku and Opus', () => {
    const raw = parseAnthropicModels({ data: [
      { id: 'claude-opus-4-1-20250805', display_name: 'Claude Opus 4.1', created_at: '2025-08-05T00:00:00Z' },
      { id: 'claude-sonnet-4-20250514', display_name: 'Claude Sonnet 4', created_at: '2025-05-14T00:00:00Z' },
      { id: 'claude-sonnet-4-5-20250929', display_name: 'Claude Sonnet 4.5', created_at: '2025-09-29T00:00:00Z' },
      { id: 'claude-haiku-4-5-20251001', display_name: 'Claude Haiku 4.5', created_at: '2025-10-01T00:00:00Z' },
    ] });
    const l = rankModels(raw, 'anthropic');
    expect(l.best?.id).toBe('claude-sonnet-4-5-20250929');
    expect(l.best?.label).toBe('Claude Sonnet 4.5');
    expect(l.models[l.models.length - 1]?.id).not.toBe('claude-haiku-4-5-20251001');
  });
});

describe('Gemini list', () => {
  it('keeps only text-generating Gemini models and picks Flash', () => {
    const raw = parseGeminiModels({ models: [
      { name: 'models/gemini-2.5-pro', displayName: 'Gemini 2.5 Pro', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1048576 },
      { name: 'models/gemini-2.5-flash', displayName: 'Gemini 2.5 Flash', supportedGenerationMethods: ['generateContent'], inputTokenLimit: 1048576 },
      { name: 'models/gemini-2.5-flash-lite', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/gemini-embedding-001', supportedGenerationMethods: ['embedContent'] },
      { name: 'models/gemma-3-27b-it', supportedGenerationMethods: ['generateContent'] },
      { name: 'models/imagen-4.0-generate-001', supportedGenerationMethods: ['predict'] },
      { name: 'models/gemini-2.5-flash-image', supportedGenerationMethods: ['generateContent'] },
    ] });
    expect(raw[0]?.id).toBe('gemini-2.5-pro'); // "models/" prefix is stripped
    expect(rankIds(raw, 'gemini')).toEqual(['gemini-2.5-flash', 'gemini-2.5-pro', 'gemini-2.5-flash-lite']);
  });
});

describe('OpenAI-compatible list (OpenRouter shape)', () => {
  const body = { data: [
    { id: 'nvidia/nemotron-3.5-lightning', name: 'NVIDIA: Nemotron 3.5 Lightning', context_length: 262144, supported_parameters: ['tools', 'temperature'], architecture: { output_modalities: ['text'] }, pricing: { prompt: '0.0000001' } },
    { id: 'nvidia/nemotron-3.5-content-safety', supported_parameters: ['temperature'], architecture: { output_modalities: ['text'] } },
    { id: 'nvidia/nemotron-3-nano-30b-a3b', supported_parameters: ['tools'], context_length: 262144, architecture: { output_modalities: ['text'] } },
    { id: 'someone/tiny-3b', supported_parameters: ['tools'], context_length: 4096, architecture: { output_modalities: ['text'] } },
    { id: 'someone/no-tools-70b', supported_parameters: ['temperature'], architecture: { output_modalities: ['text'] } },
    { id: 'google/gemini-2.5-flash-image', supported_parameters: ['tools'], architecture: { output_modalities: ['image', 'text'] } },
    { id: 'openai/gpt-5-mini:batch', supported_parameters: ['tools'], architecture: { output_modalities: ['text'] } },
    { id: 'anthropic/claude-opus-4.1', supported_parameters: ['tools'], context_length: 200000, architecture: { output_modalities: ['text'] }, pricing: { prompt: '0.000015' } },
  ] };
  it('parses tool support, context, price and modalities', () => {
    const raw = parseOpenAiModels(body);
    expect(raw[0]).toMatchObject({ id: 'nvidia/nemotron-3.5-lightning', supportsTools: true, contextTokens: 262144 });
    expect(raw[0]?.promptPricePerM).toBeCloseTo(0.1);
    expect(raw[1]?.supportsTools).toBe(false);
  });
  it('drops safety, no-tool, image-output and batch models, and ranks Nemotron Lightning first', () => {
    const l = rankModels(parseOpenAiModels(body), 'openai-compatible');
    const ids = l.models.map((m) => m.id);
    expect(ids).not.toContain('nvidia/nemotron-3.5-content-safety');
    expect(ids).not.toContain('someone/no-tools-70b');
    expect(ids).not.toContain('google/gemini-2.5-flash-image');
    expect(ids).not.toContain('openai/gpt-5-mini:batch');
    expect(l.best?.id).toBe('nvidia/nemotron-3.5-lightning');
    expect(ids.indexOf('someone/tiny-3b')).toBeGreaterThan(ids.indexOf('anthropic/claude-opus-4.1'));
    expect(l.hiddenCount).toBe(4);
    expect(l.totalCount).toBe(8);
  });
  it('accepts a bare array of ids and an Ollama-style {models:[]} list', () => {
    expect(parseOpenAiModels(['llama3.1:70b', 'qwen3:32b']).map((m) => m.id)).toEqual(['llama3.1:70b', 'qwen3:32b']);
    expect(parseOpenAiModels({ models: [{ name: 'llama3.1:8b' }] })[0]?.id).toBe('llama3.1:8b');
    expect(parseOpenAiModels({ nope: true })).toEqual([]);
  });
  it('keeps Llama instruct models and Gemini Pro visible', () => {
    expect(rankIds(oa(['meta/llama-3.3-70b-instruct']), 'openai-compatible')).toEqual(['meta/llama-3.3-70b-instruct']);
    expect(rankIds(oa(['gemini-2.5-pro']), 'gemini')).toEqual(['gemini-2.5-pro']);
  });
});

describe('chooseModel', () => {
  const listing = rankModels(oa(['gpt-5-mini', 'gpt-4.1-mini', 'gpt-4o-mini', 'gpt-3.5-turbo']), 'openai');
  it('picks the best when nothing is chosen yet', () => {
    expect(chooseModel('', listing)).toMatchObject({ model: 'gpt-5-mini', changed: true });
  });
  it('replaces a model that is no longer available', () => {
    const r = chooseModel('gpt-4-removed', listing);
    expect(r).toMatchObject({ model: 'gpt-5-mini', changed: true });
    expect(r.reason).toContain('no longer available');
  });
  it('switches when a clearly better model appears, but not for a small gain', () => {
    expect(chooseModel('gpt-3.5-turbo', listing).changed).toBe(true);
    const close = listing.models.find((m) => m.id === 'gpt-4.1-mini')!;
    expect(listing.best!.score - close.score).toBeLessThan(SWITCH_MARGIN);
    expect(chooseModel('gpt-4.1-mini', listing)).toMatchObject({ model: 'gpt-4.1-mini', changed: false });
  });
  it('leaves the model alone when nothing suitable is listed', () => {
    expect(chooseModel('mine', rankModels(oa(['text-embedding-3-small']), 'openai'))).toMatchObject({ model: 'mine', changed: false });
  });
});

describe('fetchModels', () => {
  afterEach(() => vi.unstubAllGlobals());
  const respond = (status: number, body: unknown) => vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }));

  it('sends the key as a header on a GET and never in the URL', async () => {
    const f = respond(200, { data: [{ id: 'gpt-5-mini' }] });
    vi.stubGlobal('fetch', f);
    const l = await fetchModels({ providerId: 'openai', baseUrl: '' }, 'sk-secret-key-123456');
    expect(l.best?.id).toBe('gpt-5-mini');
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.openai.com/v1/models');
    expect(url).not.toContain('secret');
    expect(init.method).toBe('GET');
    expect(init.body).toBeUndefined();
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer sk-secret-key-123456');
  });
  it('uses each provider\'s own endpoint and headers', async () => {
    const a = respond(200, { data: [{ id: 'claude-sonnet-4-5' }] });
    vi.stubGlobal('fetch', a);
    await fetchModels({ providerId: 'anthropic', baseUrl: '' }, 'sk-ant-secret-123456');
    expect((a.mock.calls[0] as unknown as [string])[0]).toBe('https://api.anthropic.com/v1/models?limit=1000');
    expect(((a.mock.calls[0] as unknown as [string, RequestInit])[1].headers as Record<string, string>)['x-api-key']).toBe('sk-ant-secret-123456');

    const g = respond(200, { models: [{ name: 'models/gemini-2.5-flash', supportedGenerationMethods: ['generateContent'] }] });
    vi.stubGlobal('fetch', g);
    await fetchModels({ providerId: 'gemini', baseUrl: '' }, 'AIzaSecret123456');
    expect((g.mock.calls[0] as unknown as [string])[0]).toContain('/v1beta/models?pageSize=1000');

    const c = vi.fn(async () => new Response(JSON.stringify({ data: [{ id: 'llama3.1:70b' }] }), {
      status: 200,
      headers: { 'content-type': 'application/json', [PROXY_MARK]: '1' },
    }));
    vi.stubGlobal('fetch', c);
    await fetchModels({ providerId: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1/chat/completions' }, 'or-secret-123456');
    const [relayUrl, relayInit] = c.mock.calls[0] as unknown as [string, RequestInit];
    const payload = JSON.parse(String(relayInit.body));
    expect(relayUrl).toBe(LLM_PROXY_PATH);
    expect(payload.url).toBe('https://openrouter.ai/api/v1/models');
    expect(payload.method).toBe('GET');
    expect(payload.headers.authorization).toBe('Bearer or-secret-123456');
    expect(relayUrl).not.toContain('or-secret');
  });
  it('explains a rejected key without echoing it', async () => {
    vi.stubGlobal('fetch', respond(401, { error: { message: 'Incorrect API key provided: sk-secret-key-123456' } }));
    const err = await fetchModels({ providerId: 'openai', baseUrl: '' }, 'sk-secret-key-123456').catch((e) => e);
    expect(err).toBeInstanceOf(TrackerError);
    expect((err as TrackerError).code).toBe('AI_KEY_REJECTED');
    expect((err as TrackerError).message).not.toContain('secret-key');
  });
  it('reports a missing key and an unreachable server', async () => {
    await expect(fetchModels({ providerId: 'openai', baseUrl: '' }, '  ')).rejects.toMatchObject({ code: 'AI_KEY_MISSING' });
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    await expect(fetchModels({ providerId: 'openai-compatible', baseUrl: 'https://integrate.api.nvidia.com/v1' }, 'nvapi-secret-123')).rejects.toMatchObject({ code: 'NETWORK' });
  });
});
