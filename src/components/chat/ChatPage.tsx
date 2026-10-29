"use client";

import { Sparkles } from "lucide-react";
import { useEffect, useRef } from "react";
import { ChatMessage, TypingIndicator } from "./ChatMessage";
import { ChatComposer } from "./ChatComposer";
import { SuggestionCards } from "./SuggestionCards";
import { useTrackerStore } from "@/store/TrackerStoreProvider";

export function ChatPage() {
  const { chatMessages, chatSending, sendChatMessage, retryLastMessage, stopGenerating } = useTrackerStore();
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [chatMessages, chatSending]);

  const isEmptyConversation = chatMessages.length <= 1;

  return (
    <div className="flex h-[calc(100dvh-7.5rem)] flex-col overflow-hidden rounded-xl border border-[var(--border-subtle)] bg-[var(--surface-raised)] shadow-soft md:h-[calc(100dvh-5.5rem)]">
      <div ref={scrollRef} className="flex-1 overflow-y-auto scrollbar-thin px-4 py-5 sm:px-6">
        <div className="mx-auto flex max-w-3xl flex-col gap-5">
          {isEmptyConversation && (
            <div className="animate-fade-in rounded-2xl border border-[var(--border-subtle)] bg-[var(--surface-sunken)] p-5 sm:p-6">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-brand-600 text-white">
                <Sparkles size={18} />
              </div>
              <h2 className="mt-3 text-base font-semibold text-[var(--text-primary)] sm:text-lg">
                What would you like to log today?
              </h2>
              <p className="mt-1.5 max-w-lg text-sm text-[var(--text-secondary)]">
                Tell me about meals, expenses, income or your weight in plain language and I&apos;ll update your dashboard.
                Ask me questions too, like how much protein you&apos;ve had today or what&apos;s left in your budget.
              </p>
              <div className="mt-4">
                <SuggestionCards onSelect={(prompt) => sendChatMessage(prompt)} />
              </div>
            </div>
          )}

          {chatMessages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              onRetry={message.status === "error" ? retryLastMessage : undefined}
            />
          ))}

          {chatSending && <TypingIndicator />}
        </div>
      </div>

      <ChatComposer onSend={(content) => sendChatMessage(content)} onStop={stopGenerating} sending={chatSending} />
    </div>
  );
}
