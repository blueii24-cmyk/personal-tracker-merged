import { describe, expect, it } from 'vitest';
import { directCalorieRequest } from './direct-calories';
import { dateKeyInTz } from '@/tracker/lib/formatting/dates';

const now = new Date('2026-10-30T00:30:00+05:30');
const parse = (message: string) => directCalorieRequest(message, now, 'Asia/Kolkata');

describe('direct calorie-only requests', () => {
  it.each([
    ['add 3000 cal for today', '2026-10-30'],
    ['please log 3,000 calories for yesterday', '2026-10-29'],
    ['can you add 3000 kcal for day before yesterday?', '2026-10-28'],
    ['record 3000 calories 3 days ago', '2026-10-27'],
    ['track 3000 cal on 2026-10-01', '2026-10-01'],
    ['add 3000 cal on 29/10/2026', '2026-10-29'],
    ['add 3000 cal for last Friday', '2026-10-23'],
    ['add 3000 cal', '2026-10-30'],
  ])('parses %s as %s in the user timezone', (message, day) => {
    const r = parse(message);
    expect(r?.kind).toBe('add');
    if (r?.kind !== 'add') throw new Error('Expected a valid request');
    expect(r.date).toBe(day);
    expect(dateKeyInTz(r.input.eatenAt, 'Asia/Kolkata')).toBe(day);
    expect(r.input.items[0]).toMatchObject({ caloriesKcal: 3000, proteinG: null, nutritionSource: 'user_entered', isEstimate: false });
  });
  it.each(['add -1 cal today', 'add 0 cal today', 'add 20001 kcal today', 'add 3000 cal for 2026-11-01', 'add 3000 cal for 2026-02-30', 'add 3000 cal for previous days'])('asks instead of saving invalid or ambiguous input: %s', (msg) => {
    expect(parse(msg)?.kind).toBe('clarify');
  });
  it.each(['how many calories today?', 'do not add 3000 cal today', 'set my target to 3000 calories', 'add 3000 cal of pizza', 'add 3000 cal and log water'])('does not intercept other intents: %s', (msg) => {
    expect(parse(msg)).toBeNull();
  });
  it('preserves a stated decimal amount in the response', () => {
    expect(parse('add 3000.5 kcal')?.message).toBe('Added 3,000.5 kcal for 2026-10-30.');
  });
});
