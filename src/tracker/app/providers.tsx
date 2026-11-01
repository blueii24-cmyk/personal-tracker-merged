import { useMemo, useState, type ReactNode } from 'react';
import { BrowserRouter } from 'react-router-dom';
import { ToastProvider } from '@/tracker/components/ui/Toast';
import { createTrackerService } from '@/tracker/lib/api/tracker-service';
import { AiConfigProvider, useAiConfig } from '@/tracker/features/ai-config/AiConfigProvider';
import { ChatProvider, type ChatSender } from '@/tracker/features/chat/ChatProvider';
import { TrackerError } from '@/tracker/lib/api/errors';
import { runByokChat } from '@/tracker/lib/ai/byok/run-chat';
import { TrackerProvider, useTracker } from '@/tracker/features/store/TrackerProvider';
import { ThemeProvider } from '@/tracker/features/theme/ThemeProvider';

function ChatBridge({ children }: { children: ReactNode }) {
  const { service, refresh } = useTracker();
  const ai = useAiConfig();
  // When "use my own model" is switched on, chat goes to that model instead of the built-in demo assistant.
  const sender = useMemo<ChatSender | undefined>(() => {
    if (!ai.config.enabled) return undefined;
    const config = ai.config;
    return async (input, opts) => {
      const apiKey = ai.getKey();
      if (!apiKey) {
        throw new TrackerError('AI_KEY_MISSING', "Your API key isn't saved in this tab any more. Add it again in Settings → AI assistant.", { retryable: false });
      }
      return runByokChat({ service, config, apiKey, input, signal: opts.signal });
    };
  }, [ai, service]);
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
          <AiConfigProvider>
            <ChatBridge>
              <BrowserRouter>{children}</BrowserRouter>
            </ChatBridge>
          </AiConfigProvider>
        </TrackerProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
