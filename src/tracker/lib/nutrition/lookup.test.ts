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

describe('meal estimates after a read-only edit', () => {
  it('keeps edits read-only, then permits a separately sent request to save one honest estimate, including on retry', async () => {
    const svc = new MockTrackerService(() => now);
    const first = await svc.sendChatMessage({ clientMessageId: 'start-edit-estimate', message: 'Hello' });
    const inputs: ProviderGenerateInput[] = [];
    const adapter: AiProviderAdapter = { providerId: 'openai-compatible', async generate(input) {
      inputs.push(structuredClone(input));
      const toolResponse = input.messages.at(-1)?.role === 'tool';
      return toolResponse
        ? { text: 'Logged one estimated bowl.', toolCalls: [], finishReason: 'stop' }
        : { text: '', toolCalls: [{ id: 'meal', name: 'log_meal', arguments: { meal_type: 'lunch', notes: 'Assumed one typical bowl (~200 g); nutrition estimated.', items: [{ food_name: 'khichdi', quantity: 200, unit: 'g', calories_kcal: 114 }] } }], finishReason: 'tool_calls' };
    } };
    const edited = await runByokChat({ service: svc, config, input: { sessionId: first.sessionId, clientMessageId: 'edit-estimate', editOfMessageId: first.userMessageId, message: 'I ate khichdi for lunch' }, adapter, now: () => now });
    expect(await svc.getMeals()).toHaveLength(0);
    expect(edited.assistantMessage).toContain('did not change or create any records');
    expect(edited.assistantMessage).not.toContain('Nutrition reference candidates');
    const input = { sessionId: edited.sessionId, clientMessageId: 'separate-estimate', message: 'I ate khichdi for lunch' };
    const logged = await runByokChat({ service: svc, config, input, adapter, now: () => now });
    expect(inputs.at(-2)?.system).toContain('reasonable typical portion');
    expect(inputs.at(-2)?.messages.at(-1)?.content).toContain('identified as an assumption');
    expect(logged.actions.filter((a) => a.status === 'succeeded')).toHaveLength(1);
    const meals = await svc.getMeals();
    expect(meals).toHaveLength(1);
    expect(meals[0]?.notes).toContain('Assumed one typical bowl');
    expect(meals[0]?.items[0]).toMatchObject({ caloriesKcal: 114, proteinG: null, isEstimate: true, nutritionSource: 'ai_estimate' });
    expect((await runByokChat({ service: svc, config, input, adapter, now: () => now })).assistantMessageId).toBe(logged.assistantMessageId);
    expect(await svc.getMeals()).toHaveLength(1);
  });
});

describe('multi-item MRP references', () => {
  it.each(['10rs', 'rs10', 'rs 10', '₹10', '10 wale'])('normalizes %s and matches both foods', (price) => {
    const text = `I ate ${price} dairymilk paket and ₹5 moong dal`;
    const reference = nutritionReference(text);
    expect(reference).toContain('### Local Indian Nutrition Database Matches');
    expect(reference).toContain('assumed ~13 g');
    expect(reference).toContain('assumed ~18 g');
    expect(reference).toContain('~8.5 g carbs');
    expect(reference).toContain('~5 g fat');
    expect(reference).toContain('unverified');
  });
  it.each([',', '&', '+', 'with', '\n'])('supports %s as an item separator', (sep) => {
    const result = nutritionReference(`₹10 dairymilk ${sep} ₹5 moong dal`);
    expect(result).toContain('assumed ~13 g');
    expect(result).toContain('assumed ~18 g');
  });
  it('does not apply calibration to a different price, flavour or explicit mass', () => {
    expect(nutritionReference('₹20 Dairy Milk')).not.toContain('assumed ~13 g');
    expect(nutritionReference('₹10 Dairy Milk Silk')).not.toContain('assumed ~13 g');
    expect(nutritionReference('₹10 Dairy Milk fruit & nut')).not.toContain('assumed ~13 g');
    expect(nutritionReference('₹10 Dairy Milk 50 g')).not.toContain('assumed ~13 g');
    expect(nutritionReference('2 ₹10 packets of dairy milk')).not.toContain('assumed ~13 g');
  });
  it('provides both hints to BYOK and blocks an erroneous expense for a meal-only request', async () => {
    const svc = new MockTrackerService(() => now);
    const previous = await svc.getTransactions();
    const inputs: ProviderGenerateInput[] = [];
    const adapter: AiProviderAdapter = { providerId: 'openai', async generate(input) {
      inputs.push(structuredClone(input));
      return inputs.length === 1 ? { text: '', finishReason: 'tool_calls', toolCalls: [
        { id: 'lookup', name: 'lookup_nutrition', arguments: { query: '₹10 dairymilk and ₹5 moong dal' } },
        { id: 'expense', name: 'add_money_transaction', arguments: { transaction_type: 'expense', amount: 15, category: 'food', description: 'snacks' } },
        { id: 'meal', name: 'log_meal', arguments: { meal_type: 'snack', notes: 'Assumed packet sizes, unverified estimates.', items: [
          { food_name: 'Dairy Milk', quantity: 13, unit: 'g', calories_kcal: 70, protein_g: 1 },
          { food_name: 'Moong dal snack', quantity: 18, unit: 'g', calories_kcal: 96, protein_g: 4.3 },
        ] } },
      ] } : { text: 'Logged estimated snacks.', finishReason: 'stop', toolCalls: [] };
    } };
    const result = await runByokChat({ service: svc, config, input: { message: 'I ate ₹10 dairymilk and ₹5 moong dal, only meals', clientMessageId: 'mrp-only' }, adapter, now: () => now });
    expect(inputs[0]?.messages.at(-1)?.content).toContain('assumed ~13 g');
    expect(inputs[0]?.messages.at(-1)?.content).toContain('assumed ~18 g');
    expect(inputs[1]?.messages.find((m) => m.role === 'tool' && m.name === 'lookup_nutrition')?.content).toContain('Moong dal');
    expect(await svc.getTransactions()).toEqual(previous);
    expect((await svc.getMeals()).at(-1)?.items).toHaveLength(2);
    expect(result.assistantMessage).toContain('No transaction was recorded');
  });
});

it('rejects a model-invented expense for an MRP food without an expense request', async () => {
  const svc = new MockTrackerService(() => now);
  const before = await svc.getTransactions();
  let round = 0;
  const adapter: AiProviderAdapter = { providerId: 'openai', async generate() {
    return ++round === 1 ? { text: '', finishReason: 'tool_calls', toolCalls: [{ id: 'bad', name: 'add_money_transaction', arguments: { transaction_type: 'expense', amount: 10, category: 'food', description: 'chocolate' } }] } : { text: 'Done', finishReason: 'stop', toolCalls: [] };
  } };
  const result = await runByokChat({ service: svc, config, input: { message: 'I ate ₹10 dairy milk', clientMessageId: 'mrp-not-expense' }, adapter, now: () => now });
  expect(await svc.getTransactions()).toEqual(before);
  expect(result.assistantMessage).toContain('No transaction was recorded');
});
