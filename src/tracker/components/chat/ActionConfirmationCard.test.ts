// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { createElement } from 'react';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { ActionConfirmationCard } from './ActionConfirmationCard';

vi.mock('@/tracker/features/store/TrackerProvider', () => ({ useTracker: () => ({ timezone: 'UTC', today: '2026-10-30', settings: {}, meals: [{ id: 'meal-1', mealType: 'lunch', eatenAt: '2026-10-30T12:00:00Z', notes: 'Assumed one bowl (~200 g).', items: [{ id: 'item', foodName: 'Khichdi', quantity: 200, unit: 'g', caloriesKcal: 114, proteinG: null, isEstimate: true }] }], transactions: [], weighIns: [] }) }));
afterEach(cleanup);

it('displays assumed portions and keeps missing protein unknown in a saved meal receipt', () => {
  const action = { status: 'succeeded' as const, toolCallId: 'call', toolName: 'log_meal', summary: 'Saved', data: { kind: 'meal' as const, operation: 'created' as const, mealId: 'meal-1' } };
  render(createElement(MemoryRouter, null, createElement(ActionConfirmationCard, { action })));
  expect(screen.getByText('Assumed one bowl (~200 g).')).toBeTruthy();
  expect(screen.getByText(/200 g Khichdi/)).toBeTruthy();
  expect(screen.getAllByText(/protein unknown/)).toHaveLength(2);
  expect(screen.getByText('Known total')).toBeTruthy();
  expect(screen.queryByText(/0 g protein/)).toBeNull();
});
