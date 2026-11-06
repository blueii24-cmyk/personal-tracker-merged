import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(() => vi.unstubAllGlobals());
import { MockTrackerService } from './mock-tracker-service';
import type { ChatReply } from '../tracker-service';

const NOW = new Date('2026-10-30T10:30:00+05:30'); // Friday, mid-morning in IST
const fresh = () => new MockTrackerService(() => NOW);
let n = 0;
const send = (svc: MockTrackerService, message: string): Promise<ChatReply> =>
  svc.sendChatMessage({ clientMessageId: `msg-${++n}`, message });

describe('demo assistant', () => {
  it('logs a meal with estimated nutrition and updates dashboard totals', async () => {
    const svc = fresh();
    const before = await svc.getDashboardSummary();
    const r = await send(svc, 'I ate three eggs, two bananas and drank a glass of milk.');
    expect(r.actions[0]?.status).toBe('succeeded');
    expect(r.actions[0]?.toolName).toBe('log_meal');
    expect(r.assistantMessage).toMatch(/estimate/i);
    const after = await svc.getDashboardSummary();
    // 3 eggs (234) + 2 bananas (210) + milk (150) = 594 kcal; protein 18.9 + 2.6 + 8 = 29.5
    expect(after.nutritionToday.caloriesKcal - before.nutritionToday.caloriesKcal).toBe(594);
    expect(after.nutritionToday.proteinG - before.nutritionToday.proteinG).toBeCloseTo(29.5, 5);
    expect(r.persistence).toBe('demo');
  });

  it('records an expense and categorises travel as transport', async () => {
    const svc = fresh();
    const before = await svc.getDashboardSummary();
    const r = await send(svc, 'I spent ₹60 travelling to college.');
    expect(r.actions[0]?.status).toBe('succeeded');
    expect(r.assistantMessage).toMatch(/transport expense of ₹60/);
    const after = await svc.getDashboardSummary();
    expect(after.budget.expenses - before.budget.expenses).toBe(60);
  });

  it('records income', async () => {
    const svc = fresh();
    const before = await svc.getDashboardSummary();
    const r = await send(svc, 'I received ₹2,000 pocket money.');
    expect(r.actions[0]?.summary).toContain('Pocket money');
    const after = await svc.getDashboardSummary();
    expect(after.budget.income - before.budget.income).toBe(2000);
    expect(after.trackedBalance - before.trackedBalance).toBe(2000);
  });

  it('logs weight and answers from saved records', async () => {
    const svc = fresh();
    const r = await send(svc, 'My weight is 48.2 kg today.');
    expect(r.actions[0]?.status).toBe('succeeded');
    const dash = await svc.getDashboardSummary();
    expect(dash.weight.latest?.weightKg).toBe(48.2);
  });

  it('asks instead of guessing when the amount is missing', async () => {
    const svc = fresh();
    const before = (await svc.getTransactions()).length;
    const r = await send(svc, 'I spent money on travel');
    expect(r.actions[0]?.status).toBe('needs_clarification');
    expect((await svc.getTransactions()).length).toBe(before);
  });

  it('asks for the unit when weight has none and rejects implausible weights', async () => {
    const svc = fresh();
    const before = (await svc.getWeighIns()).length;
    expect((await send(svc, 'my weight is 48.2')).actions[0]?.status).toBe('needs_clarification');
    expect((await send(svc, 'my weight is 4.8 kg')).actions[0]?.status).toBe('rejected');
    expect((await svc.getWeighIns()).length).toBe(before);
  });

  it('does not invent nutrition for unknown foods', async () => {
    const svc = fresh();
    const before = (await svc.getMeals()).length;
    const r = await send(svc, 'I ate a zorblax');
    expect(r.actions[0]?.status).toBe('needs_clarification');
    expect((await svc.getMeals()).length).toBe(before);
  });

  it('saves partially unknown foods with null (unknown) nutrition', async () => {
    const svc = fresh();
    const r = await send(svc, 'I had two eggs and a zorblax for lunch');
    expect(r.actions[0]?.status).toBe('succeeded');
    const meals = await svc.getMeals();
    const meal = meals.find((m) => m.id === r.actions[0]?.recordIds?.[0]);
    const unknown = meal?.items.find((i) => i.foodName === 'Zorblax');
    expect(unknown?.caloriesKcal).toBeNull();
    expect(unknown?.proteinG).toBeNull();
  });

  it("corrects yesterday's travel expense to ₹30 when exactly one matches, otherwise asks", async () => {
    const confirm = vi.fn(() => true);
    vi.stubGlobal('confirm', confirm);
    const svc = fresh();
    // Two identical fares are ambiguous, so it must ask rather than choosing one.
    await send(svc, 'I spent ₹30 on a bus yesterday');
    await send(svc, 'I spent ₹30 on another bus yesterday');
    const ambiguous = await send(svc, "Correct yesterday's travel expense to ₹30.");
    expect(ambiguous.actions[0]?.status).toBe('needs_clarification');

    await send(svc, 'I spent ₹90 on an uber yesterday');
    const all = await svc.getTransactions({ category: 'transport' });
    const uber = all.find((t) => t.amount === 90)!;
    expect(uber).toBeTruthy();
    const r = await send(svc, "Correct yesterday's uber expense to ₹30.");
    expect(r.actions[0]?.status).toBe('succeeded');
    expect((await svc.getTransactions()).find((t) => t.id === uber.id)?.amount).toBe(30);
    expect(confirm).toHaveBeenCalledOnce();
  });

  it('is idempotent for a retried clientMessageId', async () => {
    const svc = fresh();
    const req = { clientMessageId: 'same-id', message: 'I spent ₹40 on tea' };
    const a = await svc.sendChatMessage(req);
    const count = (await svc.getTransactions()).length;
    const b = await svc.sendChatMessage(req);
    expect(b.assistantMessageId).toBe(a.assistantMessageId);
    expect((await svc.getTransactions()).length).toBe(count);
  });

  it('answers budget questions from records and separates budget from balance', async () => {
    const svc = fresh();
    await svc.updateUserSettings({ monthlyBudget: 5000 });
    await send(svc, 'I spent ₹100 on lunch this month');
    const r = await send(svc, 'How much money do I have left this month?');
    expect(r.assistantMessage).toMatch(/left in your October 2026 budget/);
    expect(r.assistantMessage).toMatch(/tracked balance/);
  });

  it('answers protein questions and reports a simulated failure as a retryable error', async () => {
    const svc = fresh();
    const r = await send(svc, 'How much protein have I eaten today?');
    expect(r.actions[0]?.toolName).toBe('get_summary');
    await expect(send(svc, 'please simulate error')).rejects.toMatchObject({ code: 'PROVIDER_UNAVAILABLE', retryable: true });
  });
});
