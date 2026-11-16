// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { MemoryRouter } from 'react-router-dom';
import { DEFAULT_SETTINGS } from '@/tracker/lib/api/mock/seed';
import BulkingPage from './BulkingPage';

const mocks = vi.hoisted(() => ({ logWater: vi.fn(async () => ({})), toast: vi.fn() }));
vi.mock('@/tracker/features/store/TrackerProvider', () => ({ useTracker: () => ({ status: 'ready', settings: DEFAULT_SETTINGS, timezone: 'Asia/Kolkata', today: '2026-11-01', meals: [], weighIns: [], logWater: mocks.logWater }) }));
vi.mock('@/tracker/components/ui/Toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('./WeightChart', () => ({ WeightChart: () => null }));
vi.mock('./CalorieHistoryChart', () => ({ CalorieHistoryChart: () => null }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('quick water logging', () => {
  it('logs to the selected earlier day and confirms after saving', async () => {
    render(createElement(MemoryRouter, { initialEntries: ['/bulking?date=2026-10-31'] }, createElement(BulkingPage)));
    fireEvent.click(screen.getByRole('button', { name: '+250 ml' }));
    await waitFor(() => expect(mocks.logWater).toHaveBeenCalledWith({ waterMl: 250, date: '2026-10-31' }));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: '250 ml water logged', tone: 'success' })));
  });
});
