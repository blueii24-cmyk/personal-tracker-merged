import { afterEach, describe, expect, it, vi } from 'vitest';
import { MockTrackerService } from '@/tracker/lib/api/mock/mock-tracker-service';
import { TrackerError } from '@/tracker/lib/api/errors';
import { AI_TOOLS } from '../tool-schemas';
import type { AiProviderAdapter, CanonicalMessage, ProviderGenerateInput, ProviderGenerateOutput } from '../provider';
import { toAnthropicMessages } from './anthropic';
import { PROXY_MARK, PROXY_PATH, PROXY_TARGET_HEADER } from './bridged-hosts';
import { baseUrlError, createAdapter, DEFAULT_CONFIG, maskKey, type ByokConfig } from './config';
import { sanitizeSchema, toGeminiContents } from './gemini';
import { redactKey } from './http';
import { normalizeBaseUrl, toOpenAiMessages } from './openai';
import { MAX_ROUNDS, runByokChat, testConnection } from './run-chat';
import { buildSystemPrompt, localIsoNow } from './system-prompt';

const NOW = new Date('2026-10-30T10:30:00+05:30');
const CONFIG: ByokConfig = { ...DEFAULT_CONFIG, enabled: true, providerId: 'openai', model: 'test-model', notes: 'Uber and auto are transport.' };
const KEY = 'sk-test-1234567890abcdef';

/* A model that answers from a script, recording what it was sent. */
type Step = Partial<ProviderGenerateOutput> | Error;
function scripted(steps: Step[]) {
  const calls: ProviderGenerateInput[] = [];
  const adapter: AiProviderAdapter = {
    providerId: 'openai',
    async generate(input) {
      calls.push(structuredClone({ ...input, signal: undefined }));
      const s = steps[Math.min(calls.length - 1, steps.length - 1)]!;
      if (s instanceof Error) throw s;
      return { text: '', toolCalls: [], finishReason: s.toolCalls?.length ? 'tool_calls' : 'stop', ...s };
    },
  };
  return { adapter, calls };
}
const call = (name: string, args: Record<string, unknown>, id = `c_${name}`) => ({ id, name, arguments: args });
let n = 0;
const run = (svc: MockTrackerService, message: string, steps: Step[], extra: { sessionId?: string; clientMessageId?: string } = {}) => {
  const s = scripted(steps);
  const p = runByokChat({ service: svc, config: CONFIG, apiKey: KEY, input: { message, clientMessageId: extra.clientMessageId ?? `m-${++n}`, sessionId: extra.sessionId }, adapter: s.adapter, now: () => NOW });
  return { ...s, p };
};
const fresh = () => new MockTrackerService(() => NOW);
const toolResults = (calls: ProviderGenerateInput[]) =>
  calls.flatMap((c) => c.messages.filter((m): m is Extract<CanonicalMessage, { role: 'tool' }> => m.role === 'tool').map((m) => JSON.parse(m.content) as Record<string, unknown>));

afterEach(() => vi.unstubAllGlobals());

describe('tool loop', () => {
  it('saves an expense the model logs, marks it as AI-created and invalidates finance', async () => {
    const svc = fresh();
    const before = (await svc.getTransactions()).length;
    const { p } = run(svc, 'bus fare 60', [
      { toolCalls: [call('add_money_transaction', { transaction_type: 'expense', amount: 60, category: 'transport', description: 'Bus fare' })] },
      { text: 'Logged ₹60 for bus fare.' },
    ]);
    const r = await p;
    const txs = await svc.getTransactions();
    expect(txs).toHaveLength(before + 1);
    const saved = txs.find((t) => t.description === 'Bus fare')!;
    expect(saved).toMatchObject({ amount: 60, type: 'expense', category: 'transport', source: 'ai', currency: 'INR' });
    expect(r.assistantMessage).toBe('Logged ₹60 for bus fare.');
    expect(r.actions).toHaveLength(1);
    expect(r.actions[0]).toMatchObject({ status: 'succeeded', toolName: 'add_money_transaction', recordIds: [saved.id] });
    expect(r.dashboardInvalidation).toEqual(expect.arrayContaining(['finance', 'history']));
    expect(r.provider).toBe('openai');
    expect(r.model).toBe('test-model');
  });

  it('logs a meal with unknown nutrition as null, never zero', async () => {
    const svc = fresh();
    const { p } = run(svc, 'ate some mystery stew and 2 eggs', [
      { toolCalls: [call('log_meal', { meal_type: 'lunch', items: [{ food_name: 'Mystery stew' }, { food_name: 'Egg', quantity: 2, unit: 'piece', calories_kcal: 156, protein_g: 12.6 }] })] },
      { text: 'Logged. The stew has no estimate.' },
    ]);
    await p;
    const meal = (await svc.getMeals()).find((m) => m.items.some((i) => i.foodName === 'Mystery stew'))!;
    const stew = meal.items.find((i) => i.foodName === 'Mystery stew')!;
    expect(stew.caloriesKcal).toBeNull();
    expect(stew.proteinG).toBeNull();
    expect(stew.nutritionSource).toBe('unknown');
    const egg = meal.items.find((i) => i.foodName === 'Egg')!;
    expect(egg).toMatchObject({ caloriesKcal: 156, proteinG: 12.6, isEstimate: true, nutritionSource: 'ai_estimate' });
    expect(meal.source).toBe('ai');
  });

  it('refuses invalid arguments, writes nothing, and tells the model why', async () => {
    const svc = fresh();
    const before = (await svc.getTransactions()).length;
    const { p, calls } = run(svc, 'spent some money', [
      { toolCalls: [call('add_money_transaction', { transaction_type: 'expense', amount: 'a lot', category: 'food', description: 'Lunch' })] },
      { text: 'How much did you spend?' },
    ]);
    const r = await p;
    expect(await svc.getTransactions()).toHaveLength(before);
    expect(toolResults(calls)[0]).toMatchObject({ ok: false });
    expect(r.assistantMessage).toBe('How much did you spend?');
    expect(r.actions.every((a) => a.status !== 'succeeded')).toBe(true);
  });

  it.each([
    ['negative amount', { transaction_type: 'expense', amount: -5, category: 'food', description: 'x' }],
    ['three decimals', { transaction_type: 'expense', amount: 10.123, category: 'food', description: 'x' }],
    ['income category on an expense', { transaction_type: 'expense', amount: 10, category: 'salary', description: 'x' }],
    ['expense category on income', { transaction_type: 'income', amount: 10, category: 'food', description: 'x' }],
    ['unknown category', { transaction_type: 'expense', amount: 10, category: 'crypto', description: 'x' }],
    ['future date', { transaction_type: 'expense', amount: 10, category: 'food', description: 'x', occurred_at: '2026-11-05T10:00:00+05:30' }],
    ['date without an offset', { transaction_type: 'expense', amount: 10, category: 'food', description: 'x', occurred_at: '2026-10-30T09:00:00' }],
    ['wrong currency', { transaction_type: 'expense', amount: 10, category: 'food', description: 'x', currency: 'USD' }],
  ])('rejects %s', async (_label, args) => {
    const svc = fresh();
    const before = (await svc.getTransactions()).length;
    const { p } = run(svc, 'x', [{ toolCalls: [call('add_money_transaction', args)] }, { text: 'Sorry.' }]);
    await p;
    expect(await svc.getTransactions()).toHaveLength(before);
  });

  it('asks for clarification instead of saving an implausible weight', async () => {
    const svc = fresh();
    const before = (await svc.getWeighIns()).length;
    const { p, calls } = run(svc, 'weighed 5', [{ toolCalls: [call('log_weight', { weight_kg: 5 })] }, { text: 'Is that kg or lb?' }]);
    const r = await p;
    expect(await svc.getWeighIns()).toHaveLength(before);
    expect(toolResults(calls)[0]).toMatchObject({ ok: false });
    expect(r.actions[0]?.status).toBe('needs_clarification');
  });

  it('hides a rejected attempt once the model fixes it', async () => {
    const svc = fresh();
    const { p } = run(svc, 'tea 20', [
      { toolCalls: [call('add_money_transaction', { transaction_type: 'expense', amount: 20, category: 'beverages', description: 'Tea' }, 'a')] },
      { toolCalls: [call('add_money_transaction', { transaction_type: 'expense', amount: 20, category: 'food', description: 'Tea' }, 'b')] },
      { text: 'Done.' },
    ]);
    const r = await p;
    expect(r.actions.map((a) => a.status)).toEqual(['succeeded']);
  });

  it('writes an identical repeated call only once', async () => {
    const svc = fresh();
    const before = (await svc.getTransactions()).length;
    const same = { transaction_type: 'expense', amount: 99, category: 'food', description: 'Snack' };
    const { p } = run(svc, 'snack 99', [{ toolCalls: [call('add_money_transaction', same, 'a'), call('add_money_transaction', same, 'b')] }, { text: 'Saved.' }]);
    const r = await p;
    expect(await svc.getTransactions()).toHaveLength(before + 1);
    expect(r.actions).toHaveLength(1);
  });

  it('corrects a record found by search and refuses unknown ids', async () => {
    const confirm = vi.fn((message: string) => Boolean(message));
    vi.stubGlobal('confirm', confirm);
    const svc = fresh();
    const tx = await svc.createTransaction({ type: 'expense', amount: 60, category: 'transport', description: 'Uber ride', merchant: 'Uber', notes: null, occurredAt: NOW.toISOString() });
    const { p, calls } = run(svc, 'that uber was 80', [
      { toolCalls: [call('search_entries', { domain: 'transactions', query: 'uber' }, 's')] },
      { toolCalls: [call('update_transaction', { id: tx.id, changes: { amount: 80 } }, 'u'), call('update_transaction', { id: 'nope', changes: { amount: 1 } }, 'x')] },
      { text: 'Changed to ₹80.' },
    ]);
    const r = await p;
    const after = (await svc.getTransactions()).find((t) => t.id === tx.id)!;
    expect(after.amount).toBe(80);
    expect(confirm).toHaveBeenCalledOnce();
    expect(confirm.mock.calls[0]?.[0]).toContain('Uber ride');
    expect((toolResults(calls)[0] as { results: Array<{ id: string }> }).results.map((x) => x.id)).toContain(tx.id);
    const updates = r.actions.filter((a) => a.toolName === 'update_transaction');
    expect(updates.find((a) => a.status === 'succeeded')?.data).toMatchObject({ kind: 'transaction', operation: 'updated', previousAmount: 60 });
    expect(r.actions.some((a) => a.toolName === 'search_entries')).toBe(false);
  });

  it('answers totals from saved records', async () => {
    const svc = fresh();
    await svc.createTransaction({ type: 'expense', amount: 125.5, category: 'food', description: 'Dinner', merchant: null, notes: null, occurredAt: NOW.toISOString() });
    const { p, calls } = run(svc, 'what did I spend today', [
      { toolCalls: [call('get_summary', { domain: 'finance', period: 'today' })] },
      { text: 'You spent ₹…' },
    ]);
    await p;
    const expected = (await svc.getTransactions({ range: { from: '2026-10-30', to: '2026-10-30' } })).filter((t) => t.type === 'expense').reduce((s, t) => s + t.amount, 0);
    const fin = (toolResults(calls)[0] as { finance: { expenses_inr: number } }).finance;
    expect(fin.expenses_inr).toBeCloseTo(expected, 2);
    expect(expected).toBeGreaterThanOrEqual(125.5);
  });

  it('stops a runaway model after the round limit', async () => {
    const svc = fresh();
    const { p, calls } = run(svc, 'loop', [{ toolCalls: [call('get_summary', { domain: 'all', period: 'today' })] }]);
    await expect(p).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE' });
    expect(calls.length).toBe(MAX_ROUNDS);
  });

  it('returns the stored reply for a retried message without calling the model again', async () => {
    const svc = fresh();
    const before = (await svc.getTransactions()).length;
    const steps: Step[] = [{ toolCalls: [call('add_money_transaction', { transaction_type: 'expense', amount: 10, category: 'food', description: 'Chai' })] }, { text: 'Saved.' }];
    const first = run(svc, 'chai 10', steps, { clientMessageId: 'same-id' });
    const r1 = await first.p;
    const second = run(svc, 'chai 10', steps, { clientMessageId: 'same-id' });
    const r2 = await second.p;
    expect(second.calls).toHaveLength(0);
    expect(r2.assistantMessageId).toBe(r1.assistantMessageId);
    expect(await svc.getTransactions()).toHaveLength(before + 1);
  });

  it('surfaces a provider failure before any write as a retryable error', async () => {
    const svc = fresh();
    const { p } = run(svc, 'hi', [new TrackerError('PROVIDER_UNAVAILABLE', 'down', { retryable: true })]);
    await expect(p).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retryable: true });
    expect(await svc.getChatSessions()).toHaveLength(0);
  });

  it('keeps already-saved records visible when the model fails after a write, so a retry cannot duplicate them', async () => {
    const svc = fresh();
    const before = (await svc.getTransactions()).length;
    const { p } = run(svc, 'chai 10', [
      { toolCalls: [call('add_money_transaction', { transaction_type: 'expense', amount: 10, category: 'food', description: 'Chai' })] },
      new TrackerError('NETWORK', 'offline', { retryable: true }),
    ]);
    const r = await p;
    expect(await svc.getTransactions()).toHaveLength(before + 1);
    expect(r.actions[0]?.status).toBe('succeeded');
    expect(r.assistantMessage).toMatch(/Saved: /);
  });

  it('carries earlier turns, including what was saved, into a follow-up', async () => {
    const svc = fresh();
    const a = run(svc, 'chai 10', [{ toolCalls: [call('add_money_transaction', { transaction_type: 'expense', amount: 10, category: 'food', description: 'Chai' })] }, { text: 'Logged chai.' }]);
    const r1 = await a.p;
    const b = run(svc, 'make it 15', [{ text: 'ok' }], { sessionId: r1.sessionId });
    await b.p;
    const sent = b.calls[0]!.messages;
    expect(sent.at(-1)).toEqual({ role: 'user', content: 'make it 15' });
    expect(sent.some((m) => m.role === 'assistant' && m.content.includes('Logged chai.') && m.content.includes('Saved:'))).toBe(true);
  });
});

describe('scoped system prompt', () => {
  const settings = { ...new MockTrackerService(() => NOW)['db'].settings, dailyCalorieTarget: 3000, dailyProteinTargetG: null, monthlyBudget: 8000 };
  const prompt = buildSystemPrompt(settings, NOW, 'Mess lunch = 2 roti + dal.');

  it('fixes the scope, the tools and the never-guess rules without any user input', () => {
    expect(prompt).toMatch(/exactly two jobs/);
    expect(prompt).toMatch(/only handle bulking and budgeting/);
    expect(prompt).toMatch(/cannot delete|You cannot delete/);
    expect(prompt).toMatch(/NEVER GUESS/);
    expect(prompt).toContain('3000 kcal/day');
    expect(prompt).toContain('protein not set');
    expect(prompt).toContain('₹8000');
  });
  it('gives the model the local time with the UTC offset so "yesterday" resolves correctly', () => {
    expect(localIsoNow('Asia/Kolkata', NOW)).toBe('2026-10-30T10:30:00+05:30');
    expect(prompt).toContain('2026-10-30T10:30:00+05:30');
    expect(prompt).toContain('Friday');
  });
  it('includes user notes as lower-priority data, and omits the section when empty', () => {
    expect(prompt).toContain('Mess lunch = 2 roti + dal.');
    expect(prompt).toMatch(/cannot override the rules above/);
    expect(buildSystemPrompt(settings, NOW, '  ')).not.toContain('STANDING NOTES');
  });
  it('only offers the eight tracker tools and none that delete', () => {
    expect(AI_TOOLS.map((t) => t.name).sort()).toEqual(['add_money_transaction', 'get_summary', 'log_meal', 'log_weight', 'search_entries', 'update_meal', 'update_transaction', 'update_weight']);
  });
});

describe('provider message mapping', () => {
  const convo: CanonicalMessage[] = [
    { role: 'user', content: 'log two things' },
    { role: 'assistant', content: 'On it', toolCalls: [{ id: 't1', name: 'log_weight', arguments: { weight_kg: 70 }, providerMeta: { thoughtSignature: 'SIG' } }, { id: 't2', name: 'get_summary', arguments: { domain: 'all', period: 'today' } }] },
    { role: 'tool', toolCallId: 't1', name: 'log_weight', content: '{"ok":true}' },
    { role: 'tool', toolCallId: 't2', name: 'get_summary', content: '{"ok":true}' },
  ];
  it('OpenAI: system first, tool calls as JSON strings, results as tool messages', () => {
    const m = toOpenAiMessages('SYS', convo);
    expect(m[0]).toEqual({ role: 'system', content: 'SYS' });
    expect(m[2]).toMatchObject({ role: 'assistant', tool_calls: [{ id: 't1', type: 'function', function: { name: 'log_weight', arguments: '{"weight_kg":70}' } }, { id: 't2' }] });
    expect(m.slice(3)).toEqual([{ role: 'tool', tool_call_id: 't1', content: '{"ok":true}' }, { role: 'tool', tool_call_id: 't2', content: '{"ok":true}' }]);
  });
  it('Anthropic: all results from one turn go in a single user message', () => {
    const m = toAnthropicMessages(convo);
    expect(m).toHaveLength(3);
    expect(m[1]).toMatchObject({ role: 'assistant', content: [{ type: 'text' }, { type: 'tool_use', id: 't1' }, { type: 'tool_use', id: 't2' }] });
    expect(m[2]).toMatchObject({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1' }, { type: 'tool_result', tool_use_id: 't2' }] });
  });
  it('Gemini: merges function responses and echoes the thought signature', () => {
    const c = toGeminiContents(convo);
    expect(c).toHaveLength(3);
    expect(c[1]!.role).toBe('model');
    expect(c[1]!.parts[1]).toMatchObject({ functionCall: { name: 'log_weight' }, thoughtSignature: 'SIG' });
    expect(c[2]!.parts).toHaveLength(2);
    expect(c[2]!.parts[0]!.functionResponse).toEqual({ name: 'log_weight', response: { ok: true } });
  });
  it('Gemini: schemas lose the keywords it rejects but keep structure', () => {
    for (const t of AI_TOOLS) {
      const json = JSON.stringify(sanitizeSchema(t.inputSchema));
      for (const bad of ['additionalProperties', 'exclusiveMinimum', 'minProperties', '"default"', '"uuid"', '"format":"date"']) expect(json).not.toContain(bad);
    }
    const meal = sanitizeSchema(AI_TOOLS.find((t) => t.name === 'log_meal')!.inputSchema) as { required: string[]; properties: Record<string, { enum?: string[] }> };
    expect(meal.required).toEqual(['meal_type', 'items']);
    expect(meal.properties.meal_type!.enum).toContain('lunch');
  });
});

describe('http, keys and addresses', () => {
  const okJson = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const stub = (res: Response | Error) => {
    const fn = vi.fn(async () => {
      if (res instanceof Error) throw res;
      return res;
    });
    vi.stubGlobal('fetch', fn);
    return fn;
  };
  const input = (over: Partial<ProviderGenerateInput> = {}): ProviderGenerateInput => ({ model: 'm', system: 's', messages: [{ role: 'user', content: 'hi' }], tools: AI_TOOLS, ...over });
  const sent = (fn: ReturnType<typeof stub>) => {
    const [url, init] = fn.mock.calls[0] as unknown as [string, RequestInit];
    return { url, headers: init.headers as Record<string, string>, body: JSON.parse(String(init.body)) as Record<string, unknown> };
  };

  it('OpenAI: bearer header, max_completion_tokens, tool definitions, parsed tool calls', async () => {
    const f = stub(okJson({ choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'x', function: { name: 'log_weight', arguments: '{"weight_kg":71}' } }] } }] }));
    const out = await createAdapter({ providerId: 'openai', baseUrl: '' }, KEY).generate(input({ maxOutputTokens: 100 }));
    const s = sent(f);
    expect(s.url).toBe('https://api.openai.com/v1/chat/completions');
    expect(s.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(s.body.max_completion_tokens).toBe(100);
    expect(s.body).not.toHaveProperty('max_tokens');
    expect((s.body.tools as unknown[]).length).toBe(8);
    expect(out.toolCalls).toEqual([{ id: 'x', name: 'log_weight', arguments: { weight_kg: 71 } }]);
    expect(out.finishReason).toBe('tool_calls');
  });
  it('OpenRouter: relays chat with max_tokens and omits an empty tools list', async () => {
    const response = okJson({ choices: [{ finish_reason: 'stop', message: { content: 'hi' } }] });
    response.headers.set(PROXY_MARK, '1');
    const f = stub(response);
    await createAdapter({ providerId: 'openai-compatible', baseUrl: 'https://openrouter.ai/api/v1/chat/completions/' }, KEY).generate(input({ tools: [], maxOutputTokens: 50 }));
    const s = sent(f);
    expect(s.url).toBe(PROXY_PATH);
    expect(s.headers[PROXY_TARGET_HEADER]).toBe('https://openrouter.ai/api/v1/chat/completions');
    expect(s.headers.authorization).toBe(`Bearer ${KEY}`);
    expect(s.body.max_tokens).toBe(50);
    expect(s.body).not.toHaveProperty('tools');
  });
  it('Anthropic: key and browser-access headers, system as a top-level field', async () => {
    const f = stub(okJson({ stop_reason: 'tool_use', content: [{ type: 'text', text: 'ok' }, { type: 'tool_use', id: 'tu', name: 'log_weight', input: { weight_kg: 70 } }] }));
    const out = await createAdapter({ providerId: 'anthropic', baseUrl: '' }, KEY).generate(input());
    const s = sent(f);
    expect(s.url).toBe('https://api.anthropic.com/v1/messages');
    expect(s.headers['x-api-key']).toBe(KEY);
    expect(s.headers['anthropic-dangerous-direct-browser-access']).toBe('true');
    expect(s.body.system).toBe('s');
    expect(typeof s.body.max_tokens).toBe('number');
    expect(out.toolCalls[0]).toMatchObject({ id: 'tu', arguments: { weight_kg: 70 } });
  });
  it('Gemini: key travels in a header, never in the URL; thought parts are hidden; signature is kept', async () => {
    const f = stub(okJson({ candidates: [{ finishReason: 'STOP', content: { parts: [{ text: 'thinking', thought: true }, { text: 'Hello' }, { functionCall: { name: 'log_weight', args: { weight_kg: 70 } }, thoughtSignature: 'S1' }] } }] }));
    const out = await createAdapter({ providerId: 'gemini', baseUrl: '' }, KEY).generate(input({ model: 'models/some-model' }));
    const s = sent(f);
    expect(s.url).toBe('https://generativelanguage.googleapis.com/v1beta/models/some-model:generateContent');
    expect(s.url).not.toContain(KEY);
    expect(s.headers['x-goog-api-key']).toBe(KEY);
    expect(out.text).toBe('Hello');
    expect(out.toolCalls[0]!.providerMeta).toEqual({ thoughtSignature: 'S1' });
  });

  it.each([
    [401, 'AI_KEY_REJECTED', false],
    [404, 'AI_MODEL_NOT_FOUND', false],
    [429, 'RATE_LIMITED', true],
    [503, 'PROVIDER_UNAVAILABLE', true],
    [400, 'INVALID_REQUEST', false],
  ])('maps HTTP %i to %s', async (status, code, retryable) => {
    stub(okJson({ error: { message: `Bad key ${KEY} here` } }, status));
    const err = await createAdapter({ providerId: 'openai', baseUrl: '' }, KEY).generate(input()).catch((e: TrackerError) => e);
    expect(err).toMatchObject({ code, retryable });
    expect((err as Error).message).not.toContain(KEY);
  });
  it('explains a network/CORS failure and never includes the key', async () => {
    stub(new TypeError('Failed to fetch'));
    const err = await createAdapter({ providerId: 'anthropic', baseUrl: '' }, KEY).generate(input()).catch((e: TrackerError) => e);
    expect(err).toMatchObject({ code: 'NETWORK', retryable: true });
    expect((err as Error).message).toMatch(/CORS/);
    expect((err as Error).message).not.toContain(KEY);
  });
  it('maps a cancelled request to ABORTED', async () => {
    stub(new DOMException('aborted', 'AbortError'));
    const ctl = new AbortController();
    ctl.abort();
    await expect(createAdapter({ providerId: 'openai', baseUrl: '' }, KEY).generate(input({ signal: ctl.signal }))).rejects.toMatchObject({ code: 'ABORTED' });
  });
  it('testConnection sends a tiny request with no tools', async () => {
    const f = stub(okJson({ choices: [{ finish_reason: 'stop', message: { content: 'OK' } }] }));
    const r = await testConnection(CONFIG, KEY);
    expect(r.ms).toBeGreaterThanOrEqual(0);
    expect(sent(f).body).not.toHaveProperty('tools');
  });

  it('redacts the full key and masked fragments', () => {
    expect(redactKey(`bad ${KEY} and ${KEY.slice(0, 12)}…`, KEY)).not.toContain(KEY.slice(0, 10));
    expect(maskKey(KEY)).toBe('sk-…cdef');
  });
  it('only accepts https addresses, or http for this device', () => {
    expect(baseUrlError('https://api.groq.com/openai/v1')).toBeNull();
    expect(baseUrlError('http://localhost:11434/v1')).toBeNull();
    expect(baseUrlError('http://127.0.0.1:1234/v1')).toBeNull();
    expect(baseUrlError('http://example.com/v1')).toMatch(/https/);
    expect(baseUrlError('https://user:pw@example.com')).toMatch(/credentials/);
    expect(baseUrlError('not a url')).toBeTruthy();
    expect(baseUrlError('')).toBeTruthy();
    expect(normalizeBaseUrl(' https://x.io/v1/ ')).toBe('https://x.io/v1');
  });
  it('refuses to build an adapter without a key', () => {
    expect(() => createAdapter({ providerId: 'openai', baseUrl: '' }, '  ')).toThrowError(expect.objectContaining({ code: 'AI_KEY_MISSING' }));
  });
});

describe('confirmation of existing record updates', () => {
  it.each(['transaction', 'meal', 'weight'] as const)('requires approval for %s and never retries after a refusal', async (kind) => {
    const svc = fresh();
    const tx = await svc.createTransaction({ type: 'expense', amount: 60, category: 'transport', description: 'Fare', merchant: null, notes: null, occurredAt: NOW.toISOString() });
    const meal = await svc.createMeal({ mealType: 'lunch', eatenAt: NOW.toISOString(), notes: null, items: [{ foodName: 'Egg', quantity: 1, unit: 'piece', caloriesKcal: null, proteinG: null, isEstimate: false, nutritionSource: 'unknown' }] });
    const weight = await svc.createWeighIn({ weightKg: 70, recordedAt: NOW.toISOString(), notes: null });
    const specs = {
      transaction: { name: 'update_transaction', args: { id: tx.id, changes: { amount: 80 } } },
      meal: { name: 'update_meal', args: { id: meal.id, changes: { meal_type: 'dinner' } } },
      weight: { name: 'update_weight', args: { id: weight.id, changes: { weight_kg: 75 } } },
    };
    const spec = specs[kind];
    const confirm = vi.fn(() => false);
    vi.stubGlobal('confirm', confirm);
    const { p } = run(svc, 'correct the record', [
      { toolCalls: [call(spec.name, spec.args, 'first')] },
      { toolCalls: [call(spec.name, spec.args, 'retry')] },
      { text: 'Updated!' },
    ]);
    const reply = await p;
    expect(confirm).toHaveBeenCalledOnce();
    expect(reply.assistantMessage).toContain('not confirmed');
    expect((await svc.getTransactions()).find((v) => v.id === tx.id)?.amount).toBe(60);
    expect((await svc.getMeals()).find((v) => v.id === meal.id)?.mealType).toBe('lunch');
    expect((await svc.getWeighIns()).find((v) => v.id === weight.id)?.weightKg).toBe(70);
    vi.stubGlobal('confirm', () => true);
    const approved = await run(svc, 'correct the record', [{ toolCalls: [call(spec.name, spec.args)] }, { text: 'Updated.' }]).p;
    expect(approved.actions.some((a) => a.status === 'succeeded' && a.toolName === spec.name)).toBe(true);
  });
});
