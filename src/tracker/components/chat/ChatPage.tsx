import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { MessagesSquare, Plus, Trash2 } from 'lucide-react';
import { Button } from '@/tracker/components/ui/Button';
import { ConfirmDialog } from '@/tracker/components/ui/Dialog';
import { ErrorState } from '@/tracker/components/ui/EmptyState';
import { MenuItem, Popover } from '@/tracker/components/ui/Popover';
import { Skeleton } from '@/tracker/components/ui/Skeleton';
import { useToast } from '@/tracker/components/ui/Toast';
import { LogoMark } from '@/tracker/components/layout/Brand';
import { APP_NAME } from '@/tracker/config';
import { useChat } from '@/tracker/features/chat/ChatProvider';
import { useTracker } from '@/tracker/features/store/TrackerProvider';
import { toTrackerError } from '@/tracker/lib/api/errors';
import { dateKeyInTz, formatRelativeDay } from '@/tracker/lib/formatting/dates';
import type { ChatSession } from '@/tracker/types/domain';
import { useAiConfig } from '@/tracker/features/ai-config/AiConfigProvider';
import { ChatComposer, type ChatComposerHandle } from './ChatComposer';
import { ChatMessage, ThinkingIndicator } from './ChatMessage';
import { SuggestionCards, type Suggestion } from './SuggestionCards';

export default function ChatPage() {
  const chat = useChat();
  const t = useTracker();
  const ai = useAiConfig();
  const { toast } = useToast();
  const location = useLocation();
  const navigate = useNavigate();
  const composer = useRef<ChatComposerHandle>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const stick = useRef(true);
  const handedOff = useRef<string | null>(null);
  const [toDelete, setToDelete] = useState<ChatSession | null>(null);
  const [deleting, setDeleting] = useState(false);

  // A prompt handed over from the Overview quick panel is sent once, then cleared from history state.
  const incoming = (location.state as { prompt?: string } | null)?.prompt;
  useEffect(() => {
    if (!incoming || handedOff.current === incoming + location.key) return;
    handedOff.current = incoming + location.key;
    chat.send(incoming);
    navigate(location.pathname, { replace: true, state: null });
  }, [incoming, location.key, location.pathname, chat, navigate]);

  // Keep the newest message in view unless the reader has scrolled up.
  useLayoutEffect(() => {
    const el = scroller.current;
    if (!el) return;
    if (chat.messages.length === 0) {
      // Empty state reads top-down; never start it scrolled to the bottom.
      el.scrollTo({ top: 0 });
      stick.current = true;
    } else if (stick.current) {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [chat.messages, chat.sending, chat.loadingHistory]);
  const onScroll = () => {
    const el = scroller.current;
    if (el) stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
  };

  const pick = (s: Suggestion) => {
    if (s.mode === 'send') chat.send(s.text);
    else composer.current?.fill(s.text, s.caretFromEnd);
  };

  const empty = chat.messages.length === 0 && !chat.loadingHistory && !chat.historyError;
  const lastIsPendingUser = chat.sending && chat.messages.at(-1)?.role === 'user';
  const tz = t.timezone;
  const current = chat.sessions.find((s) => s.id === chat.activeSessionId);

  const confirmDelete = async () => {
    if (!toDelete) return;
    setDeleting(true);
    try {
      await chat.deleteSession(toDelete.id);
      toast({ title: 'Conversation deleted', description: 'Records the assistant saved are kept.', tone: 'success' });
      setToDelete(null);
    } catch (e) {
      toast({ title: "Couldn't delete the conversation", description: toTrackerError(e).message, tone: 'error' });
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 border-b border-line px-3 sm:px-5 md:h-14">
        <h1 className="min-w-0 truncate text-sm font-semibold text-ink">{current?.title ?? 'New chat'}</h1>
        <div className="flex shrink-0 items-center gap-1">
          <Popover
            align="end"
            className="w-[min(22rem,calc(100vw-1.5rem))]"
            trigger={({ toggle, open, id, ref }) => (
              <Button ref={ref} variant="ghost" size="sm" onClick={toggle} aria-haspopup="true" aria-expanded={open} aria-controls={open ? id : undefined}>
                <MessagesSquare className="size-4" aria-hidden />
                <span className="hidden sm:inline">Conversations</span>
                <span className="sr-only sm:hidden">Conversations</span>
              </Button>
            )}
          >
            {({ close }) =>
              chat.sessions.length === 0 ? (
                <p className="px-3 py-4 text-center text-[13px] text-ink-3">Your conversations will be listed here.</p>
              ) : (
                <ul className="scroll-thin max-h-72 overflow-y-auto" aria-label="Conversations">
                  {chat.sessions.map((s) => (
                    <li key={s.id} className="group flex items-center">
                      <div className="min-w-0 flex-1">
                        <MenuItem
                          active={s.id === chat.activeSessionId}
                          onClick={() => {
                            chat.openSession(s.id);
                            close();
                          }}
                        >
                          <span className="block truncate">{s.title}</span>
                          <span className="block text-xs font-normal text-ink-3">{formatRelativeDay(dateKeyInTz(s.updatedAt, tz), t.today)}</span>
                        </MenuItem>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        aria-label={`Delete conversation ${s.title}`}
                        className="hover:text-danger"
                        onClick={() => {
                          setToDelete(s);
                          close();
                        }}
                      >
                        <Trash2 className="size-4" aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              )
            }
          </Popover>
          <Button variant="secondary" size="sm" onClick={chat.newChat} disabled={empty && !chat.sending}>
            <Plus className="size-4" aria-hidden />
            New chat
          </Button>
        </div>
      </div>

      <div ref={scroller} onScroll={onScroll} className="scroll-thin min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col px-4 py-6 sm:px-6">
          {chat.loadingHistory ? (
            <div role="status" aria-label="Loading conversation" className="space-y-5">
              <Skeleton className="ml-auto h-10 w-2/3" />
              <Skeleton className="h-20 w-full" />
            </div>
          ) : chat.historyError ? (
            <ErrorState title="Couldn't open this conversation" message={chat.historyError} onRetry={() => chat.activeSessionId && chat.openSession(chat.activeSessionId)} />
          ) : empty ? (
            <div className="my-auto py-6">
              <LogoMark className="mb-5 size-11 rounded-xl" />
              <h2 className="display text-[30px] leading-tight text-ink sm:text-[38px]">What would you like to log?</h2>
              <p className="mt-3 max-w-xl text-[15px] text-ink-2">
                {APP_NAME}'s assistant turns a sentence into a saved record. Tell it what you ate, spent, received or weigh, or ask about your totals. Corrections work too.
              </p>
              <div className="mt-6">
                <SuggestionCards onPick={pick} />
              </div>
            </div>
          ) : (
            <div role="log" aria-live="polite" aria-label="Conversation" className="space-y-6">
              {chat.messages.map((m) => (
                <ChatMessage key={m.id} message={m} timezone={tz} busy={chat.sending} onRetry={chat.retry} />
              ))}
              {lastIsPendingUser && <ThinkingIndicator />}
            </div>
          )}
        </div>
      </div>

      <div className="shrink-0 bg-canvas safe-bottom px-3 pt-2 sm:px-6">
        <div className="mx-auto w-full max-w-3xl">
          <ChatComposer ref={composer} sending={chat.sending} onSend={chat.send} onStop={chat.stop} autoFocus />
          <p className="mt-1 mb-0.5 text-center text-[11px] text-ink-3">
            {ai.active
              ? `Answered by ${ai.config.model} with your own key. It only handles budgeting and bulking. Nutrition figures are estimates. Records stay in this browser.`
              : t.service.mode === 'demo'
                ? 'Demo assistant: replies come from built-in rules, not an AI model. Records stay in this browser.'
                : 'Nutrition figures are estimates.'}
          </p>
        </div>
      </div>

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete this conversation?"
        description="The messages will be removed. Meals, expenses and weights the assistant saved stay in your records."
        confirmLabel="Delete conversation"
        loading={deleting}
        onConfirm={confirmDelete}
        onClose={() => !deleting && setToDelete(null)}
      />
    </div>
  );
}
