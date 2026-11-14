import { describe, expect, it } from 'vitest';
import { findPackagedFoods, nutritionReference } from './lookup';
import { MockTrackerService } from '@/tracker/lib/api/mock/mock-tracker-service';
import { DEFAULT_CONFIG } from '@/tracker/lib/ai/byok/config';
import { runByokChat } from '@/tracker/lib/ai/byok/run-chat';
import { validateGenerateInput, toProviderBody } from '../../../../supabase/functions/_shared/ai-core';
import type { AiProviderAdapter, ProviderGenerateInput } from '@/tracker/lib/ai/provider';

const now = new Date('2026-10-30T10:30:00Z');
const config = { ...DEFAULT_CONFIG, model: 'test' };

describe('offline nutrition reference', () => {
  it('finds a specific brand and flavour, without matching a brand alone', () => {
    expect(findPackagedFoods('I ate 30 g Kurkure Masala Munch').some((p) => p.name.includes('Masala Munch'))).toBe(true);
    expect(findPackagedFoods('I ate Kurkure')).toEqual([]);
  });
  it('returns barcode matches and preserves missing protein as unknown', () => {
    expect(nutritionReference('5061013949910')).toContain('protein unknown');
    expect(nutritionReference('5061013949910')).toContain('openfoodfacts.org/product/5061013949910');
  });
  it('treats dish values as recipe estimates and never fills in unknown protein', () => {
    const reference = nutritionReference('100g khichdi');
    expect(reference).toContain('57 kcal per 100 g; protein unknown');
    expect(reference).toContain('particular recipe');
  });
  it('does not add unrelated data to ordinary messages', () => {
    expect(nutritionReference('I spent 100 on transport')).toBe('');
  });
  it.each(['openai', 'openai-compatible'] as const)('sends reference to %s without storing it in chat and without new tools', async (providerId) => {
    const svc = new MockTrackerService(() => now);
    let sent: ProviderGenerateInput | undefined;
    const adapter: AiProviderAdapter = { providerId, async generate(input) { sent = structuredClone(input); return { text: 'Please check the label.', toolCalls: [], finishReason: 'stop' }; } };
    const message = 'I ate 30 g Kurkure Masala Munch';
    const result = await runByokChat({ service: svc, config, input: { message, clientMessageId: `food-${providerId}` }, adapter, now: () => now });
    expect(sent?.messages.at(-1)?.content).toContain('Open Food Facts');
    expect(result.assistantMessage).toContain('Open Food Facts');
    if (providerId === 'openai-compatible') {
      const relayInput = validateGenerateInput({ messages: sent!.messages, context: sent!.relayContext, mode: 'log', maxOutputTokens: 1500 });
      expect(JSON.stringify(toProviderBody(relayInput, 'model', 'system'))).toContain('Kurkure Masala Munch');
    }
    expect(sent?.tools.map((t) => t.name)).not.toContain('lookup_food');
    expect((await svc.getChatHistory(result.sessionId))[0]?.content).toBe(message);
    expect(await svc.getMeals()).toHaveLength(0);
  });
  it('does not add reference or tools to casual chat', async () => {
    const svc = new MockTrackerService(() => now);
    let sent: ProviderGenerateInput | undefined;
    const adapter: AiProviderAdapter = { providerId: 'openai', async generate(input) { sent = input; return { text: 'Hello', toolCalls: [], finishReason: 'stop' }; } };
    await runByokChat({ service: svc, config, input: { mode: 'casual', message: '100 g khichdi', clientMessageId: 'casual-food' }, adapter, now: () => now });
    expect(sent?.messages.at(-1)?.content).toBe('100 g khichdi');
    expect(sent?.tools).toEqual([]);
  });

  it('keeps food corrections read-only even when a reference is present', async () => {
    const svc = new MockTrackerService(() => now);
    const first = await svc.sendChatMessage({ clientMessageId: 'before-edit', message: 'I ate two eggs' });
    const meals = await svc.getMeals();
    let calls = 0;
    const adapter: AiProviderAdapter = { providerId: 'openai', async generate() {
      calls++;
      return calls === 1
        ? { text: '', toolCalls: [{ id: 'w', name: 'log_meal', arguments: { meal_type: 'snack', items: [{ food_name: 'samosa', calories_kcal: 310 }] } }], finishReason: 'tool_calls' }
        : { text: 'Saved', toolCalls: [], finishReason: 'stop' };
    } };
    const reply = await runByokChat({ service: svc, config, input: { sessionId: first.sessionId, clientMessageId: 'edit-food', editOfMessageId: first.userMessageId, message: '100 g samosa' }, adapter, now: () => now });
    expect(await svc.getMeals()).toEqual(meals);
    expect(reply.actions.some((action) => action.status === 'succeeded')).toBe(false);
    expect(reply.assistantMessage).toContain('did not change or create any records');
  });
  it('looks back for a short portion clarification without changing the original message', async () => {
    const svc = new MockTrackerService(() => now);
    const inputs: ProviderGenerateInput[] = [];
    const adapter: AiProviderAdapter = { providerId: 'openai', async generate(input) { inputs.push(structuredClone(input)); return { text: 'Please clarify.', toolCalls: [], finishReason: 'stop' }; } };
    const first = await runByokChat({ service: svc, config, input: { message: 'Kurkure Masala Munch', clientMessageId: 'first' }, adapter, now: () => now });
    const second = await runByokChat({ service: svc, config, input: { message: '30 g', clientMessageId: 'second', sessionId: first.sessionId }, adapter, now: () => now });
    expect(inputs[1]?.messages.at(-1)?.content).toContain('Masala Munch');
    expect((await svc.getChatHistory(second.sessionId)).find((m) => m.id === second.userMessageId)?.content).toBe('30 g');
  });
});
