import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { isAbortError, toTrackerError } from '@/tracker/lib/api/errors';
import type { ChatReply, RequestOptions, TrackerService } from '@/tracker/lib/api/tracker-service';
import type { AiChatRequest } from '@/tracker/types/api';
import type { ChatErrorInfo, ChatMessage, ChatSession } from '@/tracker/types/domain';

interface ChatApi {
  sessions: ChatSession[];
  activeSessionId: string | null;
  messages: ChatMessage[];
  sending: boolean;
  loadingHistory: boolean;
  historyError: string | null;
  send: (text: string) => void;
  retry: (messageId: string) => void;
  stop: () => void;
  newChat: () => void;
  openSession: (id: string) => void;
  deleteSession: (id: string) => Promise<void>;
}
const ChatContext = createContext<ChatApi | null>(null);

const newId = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `m-${Date.now()}-${Math.random().toString(36).slice(2)}`);

/**
 * Chat state lives above the router so an in-flight request survives navigation.
 * `onRecordsChanged` refreshes shared totals whenever the assistant reports a change.
 */
export type ChatSender = (input: AiChatRequest, opts: RequestOptions) => Promise<ChatReply>;

export function ChatProvider({ service, onRecordsChanged, sender, children }: { service: TrackerService; onRecordsChanged: () => Promise<void>; /** Replaces the service's own assistant, e.g. with the user's own model. */ sender?: ChatSender; children: ReactNode }) {
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActive] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [sending, setSending] = useState(false);
  const [loadingHistory, setLoadingHistory] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const controller = useRef<AbortController | null>(null);
  const activeRef = useRef<string | null>(null);
  activeRef.current = activeSessionId;

  const loadSessions = useCallback(async () => {
    try {
      setSessions(await service.getChatSessions());
    } catch {
      /* the list is a convenience; the chat itself still works */
    }
  }, [service]);
  useEffect(() => {
    void loadSessions();
  }, [loadSessions]);

  const patchMessage = useCallback((id: string, patch: Partial<ChatMessage>) => {
    setMessages((ms) => ms.map((m) => (m.id === id ? { ...m, ...patch } : m)));
  }, []);

  const dispatch = useCallback(
    async (userMessage: ChatMessage) => {
      const ctl = new AbortController();
      controller.current = ctl;
      setSending(true);
      patchMessage(userMessage.id, { status: 'sending', error: undefined });
      try {
        const request: AiChatRequest = { sessionId: userMessage.sessionId ?? undefined, clientMessageId: userMessage.clientMessageId!, message: userMessage.content };
        const reply = await (sender ?? ((r, o) => service.sendChatMessage(r, o)))(request, { signal: ctl.signal });
        setActive(reply.sessionId);
        setMessages((ms) => [
          ...ms.map((m) => (m.id === userMessage.id ? { ...m, id: reply.userMessageId, sessionId: reply.sessionId, status: 'complete' as const, error: undefined } : m)),
          {
            id: reply.assistantMessageId,
            sessionId: reply.sessionId,
            role: 'assistant' as const,
            content: reply.assistantMessage,
            createdAt: new Date().toISOString(),
            status: 'complete' as const,
            actions: reply.actions,
          },
        ]);
        if (reply.dashboardInvalidation.length > 0) await onRecordsChanged().catch(() => undefined);
        void loadSessions();
      } catch (e) {
        const err = toTrackerError(e);
        const info: ChatErrorInfo = isAbortError(e)
          ? { code: 'ABORTED', message: 'You stopped this request. Nothing was saved.', retryable: true }
          : { code: err.code, message: err.message, retryable: err.retryable };
        patchMessage(userMessage.id, { status: 'error', error: info });
      } finally {
        if (controller.current === ctl) controller.current = null;
        setSending(false);
      }
    },
    [service, sender, patchMessage, onRecordsChanged, loadSessions],
  );

  const send = useCallback(
    (text: string) => {
      const content = text.trim();
      if (!content || controller.current) return;
      const msg: ChatMessage = {
        id: newId(),
        sessionId: activeRef.current,
        role: 'user',
        content,
        createdAt: new Date().toISOString(),
        status: 'sending',
        clientMessageId: newId(),
      };
      setMessages((ms) => [...ms, msg]);
      void dispatch(msg);
    },
    [dispatch],
  );

  const retry = useCallback(
    (messageId: string) => {
      if (controller.current) return;
      const msg = messages.find((m) => m.id === messageId && m.role === 'user');
      if (msg) void dispatch(msg);
    },
    [messages, dispatch],
  );

  const stop = useCallback(() => controller.current?.abort(), []);

  const newChat = useCallback(() => {
    controller.current?.abort();
    setActive(null);
    setMessages([]);
    setHistoryError(null);
  }, []);

  const openSession = useCallback(
    (id: string) => {
      controller.current?.abort();
      setActive(id);
      setMessages([]);
      setHistoryError(null);
      setLoadingHistory(true);
      service
        .getChatHistory(id)
        .then((ms) => {
          if (activeRef.current === id) setMessages(ms);
        })
        .catch((e) => {
          if (activeRef.current === id) setHistoryError(toTrackerError(e).message);
        })
        .finally(() => setLoadingHistory(false));
    },
    [service],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      await service.deleteChatSession(id);
      if (activeRef.current === id) newChat();
      await loadSessions();
    },
    [service, newChat, loadSessions],
  );

  const value = useMemo<ChatApi>(
    () => ({ sessions, activeSessionId, messages, sending, loadingHistory, historyError, send, retry, stop, newChat, openSession, deleteSession }),
    [sessions, activeSessionId, messages, sending, loadingHistory, historyError, send, retry, stop, newChat, openSession, deleteSession],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatApi {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
}
