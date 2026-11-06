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
  edit: (messageId: string, text: string) => boolean;
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
  const updateActive = useCallback((id: string | null) => {
    activeRef.current = id;
    setActive(id);
  }, []);

  const fetchSessions = useCallback(async (): Promise<ChatSession[] | null> => {
    try {
      return await service.getChatSessions();
    } catch {
      /* the list is a convenience; the chat itself still works */
      return null;
    }
  }, [service]);
  useEffect(() => {
    let cancelled = false;
    void fetchSessions().then((nextSessions) => {
      if (!cancelled && nextSessions) setSessions(nextSessions);
    });
    return () => {
      cancelled = true;
    };
  }, [fetchSessions]);

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
        const request: AiChatRequest = { sessionId: userMessage.sessionId ?? undefined, clientMessageId: userMessage.clientMessageId!, message: userMessage.content, editOfMessageId: userMessage.editOfMessageId };
        const reply = await (sender ?? ((r, o) => service.sendChatMessage(r, o)))(request, { signal: ctl.signal });
        // Refresh saved records and conversation list even if the user navigated while sending.
        if (reply.dashboardInvalidation.length > 0) await onRecordsChanged().catch(() => undefined);
        void fetchSessions().then((nextSessions) => { if (nextSessions) setSessions(nextSessions); });
        // Navigation while a request is in flight must not replace a different conversation.
        if (activeRef.current !== userMessage.sessionId) return;
        if (userMessage.editOfMessageId) {
          const revised = await service.getChatHistory(reply.sessionId);
          if (activeRef.current !== userMessage.sessionId) return;
          updateActive(reply.sessionId);
          setMessages(revised);
        } else {
          updateActive(reply.sessionId);
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
        }
      } catch (e) {
        const err = toTrackerError(e);
        const info: ChatErrorInfo = isAbortError(e)
          ? { code: 'ABORTED', message: 'You stopped this request. Nothing was saved.', retryable: true }
          : { code: err.code, message: err.message, retryable: err.retryable };
        if (activeRef.current === userMessage.sessionId) patchMessage(userMessage.id, { status: 'error', error: info });
      } finally {
        if (controller.current === ctl) controller.current = null;
        setSending(false);
      }
    },
    [service, sender, patchMessage, onRecordsChanged, fetchSessions, updateActive],
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

  const edit = useCallback((messageId: string, text: string): boolean => {
    const content = text.trim();
    const original = messages.find((m) => m.id === messageId && m.role === 'user' && m.status === 'complete');
    if (!original || !activeRef.current || original.sessionId !== activeRef.current || !content || content.length > 4000 || content === original.content || controller.current) return false;
    const msg: ChatMessage = {
      ...original, content, status: 'sending', clientMessageId: newId(), editOfMessageId: original.id,
    };
    // The untouched original conversation remains recoverable; show the new branch from this point.
    setMessages((ms) => {
      const index = ms.findIndex((m) => m.id === original.id);
      return index < 0 ? ms : [...ms.slice(0, index), msg];
    });
    void dispatch(msg);
    return true;
  }, [messages, dispatch]);

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
    updateActive(null);
    setMessages([]);
    setHistoryError(null);
  }, [updateActive]);

  const openSession = useCallback(
    (id: string) => {
      controller.current?.abort();
      updateActive(id);
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
    [service, updateActive],
  );

  const deleteSession = useCallback(
    async (id: string) => {
      await service.deleteChatSession(id);
      if (activeRef.current === id) newChat();
      const nextSessions = await fetchSessions();
      if (nextSessions) setSessions(nextSessions);
    },
    [service, newChat, fetchSessions],
  );

  const value = useMemo<ChatApi>(
    () => ({ sessions, activeSessionId, messages, sending, loadingHistory, historyError, send, edit, retry, stop, newChat, openSession, deleteSession }),
    [sessions, activeSessionId, messages, sending, loadingHistory, historyError, send, edit, retry, stop, newChat, openSession, deleteSession],
  );
  return <ChatContext.Provider value={value}>{children}</ChatContext.Provider>;
}

export function useChat(): ChatApi {
  const ctx = useContext(ChatContext);
  if (!ctx) throw new Error('useChat must be used inside <ChatProvider>');
  return ctx;
}
