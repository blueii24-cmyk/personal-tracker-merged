import { useMemo, useState, type ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { NativeBridge } from './NativeBridge';
import { ToastProvider } from '@/tracker/components/ui/Toast';
import { createTrackerService } from '@/tracker/lib/api/tracker-service';
import { AiConfigProvider, useAiConfig } from '@/tracker/features/ai-config/AiConfigProvider';
import { ChatProvider, type ChatSender } from '@/tracker/features/chat/ChatProvider';
import { TrackerError } from '@/tracker/lib/api/errors';
import { runByokChat } from '@/tracker/lib/ai/byok/run-chat';
import { DefaultAiAdapter } from '@/tracker/lib/ai/default-ai';
import { AuthProvider, useAuth } from '@/tracker/features/auth/AuthProvider';
import { TrackerProvider, useTracker } from '@/tracker/features/store/TrackerProvider';
import { ThemeProvider } from '@/tracker/features/theme/ThemeProvider';

function ChatBridge({ children }: { children: ReactNode }) {
  const { service, refresh } = useTracker();
  const ai = useAiConfig();
  const { user } = useAuth();
  // BYOK always wins. Otherwise signed-in users get the authenticated default relay;
  // signed-out users keep the completely on-device rule-based assistant.
  const sender = useMemo<ChatSender | undefined>(() => {
    if (ai.config.enabled) {
      const config = ai.config;
      return async (input, opts) => {
        const apiKey = ai.getKey();
        if (!apiKey) {
          throw new TrackerError('AI_KEY_MISSING', "Your API key isn't saved in this tab any more. Add it again in Settings → AI assistant.", { retryable: false });
        }
        return runByokChat({ service, config, apiKey, input, signal: opts.signal });
      };
    }
    if (!user) return undefined;
    const config = { ...ai.config, providerId: 'openai-compatible' as const, model: 'Personal Tracker AI', baseUrl: '', autoModel: false };
    return (input: Parameters<ChatSender>[0], opts: Parameters<ChatSender>[1]) => runByokChat({
      service, config, input, signal: opts.signal, adapter: new DefaultAiAdapter(),
    });
  }, [ai, service, user]);
  return (
    <ChatProvider service={service} onRecordsChanged={refresh} sender={sender}>
      {children}
    </ChatProvider>
  );
}

export function AppProviders({ children }: { children: ReactNode }) {
  const [service] = useState(createTrackerService);
  return (
    <ThemeProvider>
      <ToastProvider>
        <TrackerProvider service={service}>
          <BrowserRouter>
            <AuthProvider>
              <AiConfigProvider>
                <ChatBridge>
                  <NativeBridge />
                  {children}
                </ChatBridge>
              </AiConfigProvider>
            </AuthProvider>
          </BrowserRouter>
        </TrackerProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
