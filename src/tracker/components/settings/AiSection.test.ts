// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { createElement } from 'react';
import { DEFAULT_CONFIG } from '@/tracker/lib/ai/byok/config';
import { AiSection } from './AiSection';

const mock = vi.hoisted(() => ({
  savedKey: vi.fn(() => 'nvapi-fake-saved-key'),
  save: vi.fn(() => null),
  fetchModels: vi.fn(async () => ({ models: [{ id: 'gemini-2.5-flash', label: 'Gemini', score: 100, reasons: [], supportsTools: true }], best: { id: 'gemini-2.5-flash', label: 'Gemini', score: 100, reasons: [], supportsTools: true }, totalCount: 1, hiddenCount: 0 })),
}));
vi.mock('@/tracker/features/ai-config/AiConfigProvider', () => ({ useAiConfig: () => ({ config: { ...DEFAULT_CONFIG, enabled: true, providerId: 'openai-compatible', baseUrl: 'https://integrate.api.nvidia.com/v1', model: 'nvidia/model', autoModel: true }, hasKey: true, keyHint: 'nva…test', active: true, getKey: mock.savedKey, save: mock.save, setEnabled: vi.fn(), removeKey: vi.fn() }) }));
vi.mock('@/tracker/features/store/TrackerProvider', () => ({ useTracker: () => ({ aiStatus: null }) }));
vi.mock('@/tracker/features/auth/AuthProvider', () => ({ useAuth: () => ({ user: null }) }));
vi.mock('@/tracker/components/ui/Toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/tracker/lib/ai/byok/models', () => ({ fetchModels: mock.fetchModels }));
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('provider switching', () => {
  it('does not send the saved NVIDIA key to Gemini, clears the prior model, and requires a replacement key', async () => {
    render(createElement(MemoryRouter, null, createElement(AiSection)));
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'unsaved-nvidia-key' } });
    fireEvent.change(screen.getByLabelText('Provider'), { target: { value: 'gemini' } });
    expect((screen.getByLabelText('API key') as HTMLInputElement).value).toBe('');
    expect((screen.getByLabelText('Model') as HTMLInputElement).value).toBe('');
    expect(screen.getByText(/Your previous key stays saved until you save a replacement/)).toBeTruthy();
    await new Promise((resolve) => setTimeout(resolve, 850));
    expect(mock.fetchModels).not.toHaveBeenCalled();
    fireEvent.submit(screen.getByRole('form', { name: 'Your AI model' }));
    expect(mock.save).not.toHaveBeenCalled();
    expect(screen.getByText('Paste your API key.')).toBeTruthy();
    fireEvent.change(screen.getByLabelText('API key'), { target: { value: 'AIza-fake-key-for-tests' } });
    await waitFor(() => expect(mock.fetchModels).toHaveBeenCalledWith({ providerId: 'gemini', baseUrl: 'https://integrate.api.nvidia.com/v1' }, 'AIza-fake-key-for-tests', expect.any(AbortSignal)), { timeout: 2500 });
    await waitFor(() => expect((screen.getByLabelText('Detected models') as HTMLSelectElement).value).toBe('gemini-2.5-flash'));
    fireEvent.submit(screen.getByRole('form', { name: 'Your AI model' }));
    expect(mock.save).toHaveBeenCalledWith(expect.objectContaining({ providerId: 'gemini', model: 'gemini-2.5-flash' }), 'AIza-fake-key-for-tests');
  });
});
