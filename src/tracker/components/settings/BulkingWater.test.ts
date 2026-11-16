// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { BulkingSection } from './SettingsSections';
import { DEFAULT_SETTINGS } from '@/tracker/lib/api/mock/seed';

const mocks = vi.hoisted(() => ({ update: vi.fn<(patch: Record<string, unknown>) => Promise<void>>(async () => undefined), toast: vi.fn() }));
vi.mock('@/tracker/features/store/TrackerProvider', () => ({ useTracker: () => ({ updateSettings: mocks.update }) }));
vi.mock('@/tracker/components/ui/Toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('daily water target', () => {
  it('saves a target and validates invalid values', async () => {
    render(createElement(BulkingSection, { settings: DEFAULT_SETTINGS }));
    const water = screen.getByLabelText(/Daily water target/);
    fireEvent.change(water, { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ dailyWaterTargetMl: 2000 })));
  });
  it('does not add a new target field when saving unrelated settings before the schema upgrade', async () => {
    render(createElement(BulkingSection, { settings: DEFAULT_SETTINGS }));
    fireEvent.change(screen.getByLabelText(/Daily calorie target/), { target: { value: '2000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledOnce());
    expect(mocks.update.mock.calls[0]![0]).not.toHaveProperty('dailyWaterTargetMl');
  });
  it('can clear an existing target', async () => {
    render(createElement(BulkingSection, { settings: { ...DEFAULT_SETTINGS, dailyWaterTargetMl: 1500 } }));
    fireEvent.change(screen.getByLabelText(/Daily water target/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(mocks.update).toHaveBeenCalledWith(expect.objectContaining({ dailyWaterTargetMl: null })));
  });
});
