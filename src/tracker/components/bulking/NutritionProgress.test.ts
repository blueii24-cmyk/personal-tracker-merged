// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { NutritionProgress } from './NutritionProgress';
import { nutritionTotals } from '@/tracker/features/meals/calculations';

afterEach(cleanup);

describe('water nutrition progress', () => {
  it('renders three neutral tracks, an empty water arc, and the settings link', () => {
    const totals = { ...nutritionTotals([]), caloriesKcal: 1200, proteinG: 40, waterMl: 500, hasEstimates: true };
    const { container } = render(createElement(MemoryRouter, null, createElement(NutritionProgress, { totals, calorieTarget: 2000, proteinTarget: 100, waterTarget: null })));
    expect(container.querySelectorAll('circle.stroke-sunken')).toHaveLength(3);
    expect(container.querySelectorAll('circle.stroke-\\[\\#5B9BD5\\]')).toHaveLength(1);
    expect(container.querySelector('circle.stroke-\\[\\#5B9BD5\\]')?.getAttribute('opacity')).toBe('0');
    expect(screen.getByText('Water')).toBeTruthy();
    expect(screen.getByText('~500')).toBeTruthy();
    expect(screen.getAllByText('Set one in Settings')[0]?.getAttribute('href')).toBe('/settings');
    expect(screen.getByText('~ Nutrition figures are estimates.')).toBeTruthy();
  });
  it('shows progress for a configured target and keeps calorie center', () => {
    const totals = { ...nutritionTotals([]), caloriesKcal: 1000, waterMl: 750 };
    render(createElement(MemoryRouter, null, createElement(NutritionProgress, { totals, calorieTarget: null, proteinTarget: null, waterTarget: 2000 })));
    expect(screen.getByRole('progressbar', { name: 'Water progress' }).getAttribute('aria-valuenow')).toBe('38');
    expect(screen.getByText('1,250 ml remaining')).toBeTruthy();
    expect(screen.getAllByText('1,000').length).toBeGreaterThan(0);
  });
});
