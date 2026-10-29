"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import type {
  ChatMessage,
  DashboardSummary,
  Meal,
  Transaction,
  UserSettings,
  WeighIn,
} from "@/types/domain";
import type {
  CreateMealInput,
  CreateTransactionInput,
  CreateWeighInInput,
  TransactionFilters,
  UpdateMealInput,
  UpdateTransactionInput,
} from "@/types/api";
import { ApiError } from "@/types/api";
import { trackerService } from "@/lib/api/tracker-service";
import { interpretMessage } from "@/lib/api/chat-engine";
import { BACKEND_MODE, generateId, simulateLatency } from "@/lib/api/client";

const DEFAULT_SESSION_ID = "default-session";

interface TrackerStoreValue {
  summary: DashboardSummary | null;
  summaryLoading: boolean;
  summaryError: string | null;
  refreshSummary: () => Promise<void>;

  settings: UserSettings | null;
  settingsLoading: boolean;
  updateSettings: (input: Partial<UserSettings>) => Promise<UserSettings>;

  meals: Meal[];
  mealsLoading: boolean;
  refreshMeals: () => Promise<void>;
  createMeal: (input: CreateMealInput) => Promise<Meal>;
  updateMeal: (id: string, input: UpdateMealInput) => Promise<Meal>;
  deleteMeal: (id: string) => Promise<void>;

  transactions: Transaction[];
  transactionsLoading: boolean;
  refreshTransactions: (filters?: TransactionFilters) => Promise<void>;
  createTransaction: (input: CreateTransactionInput) => Promise<Transaction>;
  updateTransaction: (id: string, input: UpdateTransactionInput) => Promise<Transaction>;
  deleteTransaction: (id: string) => Promise<void>;

  weighIns: WeighIn[];
  weighInsLoading: boolean;
  refreshWeighIns: () => Promise<void>;
  createWeighIn: (input: CreateWeighInInput) => Promise<WeighIn>;
  deleteWeighIn: (id: string) => Promise<void>;

  chatMessages: ChatMessage[];
  chatSending: boolean;
  sendChatMessage: (content: string) => Promise<void>;
  retryLastMessage: () => Promise<void>;
  stopGenerating: () => void;
}

const TrackerStoreContext = createContext<TrackerStoreValue | null>(null);

function welcomeMessage(): ChatMessage {
  return {
    id: generateId("msg"),
    role: "assistant",
    content:
      "Hi! I'm your tracker assistant. Tell me what you ate, what you spent or earned, or your latest weight \u2014 I'll log it for you.",
    createdAt: new Date().toISOString(),
    status: "sent",
  };
}

export function TrackerStoreProvider({ children }: { children: ReactNode }) {
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(true);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [settings, setSettings] = useState<UserSettings | null>(null);
  const [settingsLoading, setSettingsLoading] = useState(true);

  const [meals, setMeals] = useState<Meal[]>([]);
  const [mealsLoading, setMealsLoading] = useState(true);

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [transactionsLoading, setTransactionsLoading] = useState(true);

  const [weighIns, setWeighIns] = useState<WeighIn[]>([]);
  const [weighInsLoading, setWeighInsLoading] = useState(true);

  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([welcomeMessage()]);
  const [chatSending, setChatSending] = useState(false);
  const lastFailedContent = useRef<string | null>(null);
  const activeTurnToken = useRef<symbol | null>(null);

  const refreshSummary = useCallback(async () => {
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const data = await trackerService.getDashboardSummary();
      setSummary(data);
    } catch (error) {
      setSummaryError(error instanceof Error ? error.message : "Couldn't load your dashboard.");
    } finally {
      setSummaryLoading(false);
    }
  }, []);

  const refreshMeals = useCallback(async () => {
    setMealsLoading(true);
    try {
      const data = await trackerService.getMeals();
      setMeals(data);
    } finally {
      setMealsLoading(false);
    }
  }, []);

  const refreshTransactions = useCallback(async (filters?: TransactionFilters) => {
    setTransactionsLoading(true);
    try {
      const data = await trackerService.getTransactions(filters);
      setTransactions(data);
    } finally {
      setTransactionsLoading(false);
    }
  }, []);

  const refreshWeighIns = useCallback(async () => {
    setWeighInsLoading(true);
    try {
      const data = await trackerService.getWeighIns();
      setWeighIns(data);
    } finally {
      setWeighInsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Initial data loading updates the store after the provider mounts.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void refreshSummary();
    void refreshMeals();
    void refreshTransactions();
    void refreshWeighIns();
    (async () => {
      setSettingsLoading(true);
      try {
        const data = await trackerService.getUserSettings();
        setSettings(data);
        if (BACKEND_MODE === "live") {
          const history = await trackerService.getChatHistory(DEFAULT_SESSION_ID);
          if (history.length > 0) setChatMessages(history);
        }
      } catch (error) {
        setSummaryError(error instanceof Error ? error.message : "Couldn't load tracker settings.");
      } finally {
        setSettingsLoading(false);
      }
    })();
  }, [refreshSummary, refreshMeals, refreshTransactions, refreshWeighIns]);

  const updateSettings = useCallback(async (input: Partial<UserSettings>) => {
    const updated = await trackerService.updateUserSettings(input);
    setSettings(updated);
    await refreshSummary();
    return updated;
  }, [refreshSummary]);

  const createMeal = useCallback(
    async (input: CreateMealInput) => {
      const meal = await trackerService.createMeal(input);
      await Promise.all([refreshMeals(), refreshSummary()]);
      return meal;
    },
    [refreshMeals, refreshSummary],
  );

  const updateMeal = useCallback(
    async (id: string, input: UpdateMealInput) => {
      const meal = await trackerService.updateMeal(id, input);
      await Promise.all([refreshMeals(), refreshSummary()]);
      return meal;
    },
    [refreshMeals, refreshSummary],
  );

  const deleteMeal = useCallback(
    async (id: string) => {
      await trackerService.deleteMeal(id);
      await Promise.all([refreshMeals(), refreshSummary()]);
    },
    [refreshMeals, refreshSummary],
  );

  const createTransaction = useCallback(
    async (input: CreateTransactionInput) => {
      const txn = await trackerService.createTransaction(input);
      await Promise.all([refreshTransactions(), refreshSummary()]);
      return txn;
    },
    [refreshTransactions, refreshSummary],
  );

  const updateTransaction = useCallback(
    async (id: string, input: UpdateTransactionInput) => {
      const txn = await trackerService.updateTransaction(id, input);
      await Promise.all([refreshTransactions(), refreshSummary()]);
      return txn;
    },
    [refreshTransactions, refreshSummary],
  );

  const deleteTransaction = useCallback(
    async (id: string) => {
      await trackerService.deleteTransaction(id);
      await Promise.all([refreshTransactions(), refreshSummary()]);
    },
    [refreshTransactions, refreshSummary],
  );

  const createWeighIn = useCallback(
    async (input: CreateWeighInInput) => {
      const weighIn = await trackerService.createWeighIn(input);
      await Promise.all([refreshWeighIns(), refreshSummary()]);
      return weighIn;
    },
    [refreshWeighIns, refreshSummary],
  );

  const deleteWeighIn = useCallback(
    async (id: string) => {
      await trackerService.deleteWeighIn(id);
      await Promise.all([refreshWeighIns(), refreshSummary()]);
    },
    [refreshWeighIns, refreshSummary],
  );

  const runChatTurn = useCallback(
    async (content: string) => {
      const userMessage: ChatMessage = {
        id: generateId("msg"),
        role: "user",
        content,
        createdAt: new Date().toISOString(),
        status: "sent",
      };
      setChatMessages((prev) => [...prev, userMessage]);
      setChatSending(true);
      lastFailedContent.current = null;
      const token = Symbol("chat-turn");
      activeTurnToken.current = token;

      try {
        let reply: string;
        let action: ChatMessage["action"];
        if (BACKEND_MODE === "live") {
          const result = await trackerService.sendChatMessage({ content, sessionId: DEFAULT_SESSION_ID });
          reply = result.reply;
          action = result.action;
        } else {
          await simulateLatency(500, 1100);
          if (activeTurnToken.current !== token) return;
          const result = interpretMessage(content);
          reply = result.reply;
          action = result.action;
        }
        if (activeTurnToken.current !== token) return;
        const assistantMessage: ChatMessage = {
          id: generateId("msg"),
          role: "assistant",
          content: reply,
          createdAt: new Date().toISOString(),
          status: "sent",
          action,
        };
        setChatMessages((prev) => [...prev, assistantMessage]);
        if (action && action.kind !== "unsupported" && action.kind !== "error" && action.kind !== "info") {
          await Promise.all([refreshSummary(), refreshMeals(), refreshTransactions(), refreshWeighIns()]);
        }
      } catch (error) {
        if (activeTurnToken.current !== token) return;
        lastFailedContent.current = content;
        const message = error instanceof ApiError ? error.message : "Something went wrong processing that message.";
        const errorMessage: ChatMessage = {
          id: generateId("msg"),
          role: "assistant",
          content: message,
          createdAt: new Date().toISOString(),
          status: "error",
        };
        setChatMessages((prev) => [...prev, errorMessage]);
      } finally {
        if (activeTurnToken.current === token) {
          activeTurnToken.current = null;
          setChatSending(false);
        }
      }
    },
    [refreshSummary, refreshMeals, refreshTransactions, refreshWeighIns],
  );

  const sendChatMessage = useCallback(async (content: string) => runChatTurn(content), [runChatTurn]);

  const stopGenerating = useCallback(() => {
    if (!activeTurnToken.current) return;
    activeTurnToken.current = null;
    setChatSending(false);
    setChatMessages((prev) => [
      ...prev,
      {
        id: generateId("msg"),
        role: "assistant",
        content: "Stopped. Let me know if you'd like to try that again.",
        createdAt: new Date().toISOString(),
        status: "sent",
      },
    ]);
  }, []);

  const retryLastMessage = useCallback(async () => {
    const content = lastFailedContent.current;
    if (!content) return;
    setChatMessages((prev) => prev.filter((m) => m.status !== "error"));
    await runChatTurn(content);
  }, [runChatTurn]);

  const value = useMemo<TrackerStoreValue>(
    () => ({
      summary,
      summaryLoading,
      summaryError,
      refreshSummary,
      settings,
      settingsLoading,
      updateSettings,
      meals,
      mealsLoading,
      refreshMeals,
      createMeal,
      updateMeal,
      deleteMeal,
      transactions,
      transactionsLoading,
      refreshTransactions,
      createTransaction,
      updateTransaction,
      deleteTransaction,
      weighIns,
      weighInsLoading,
      refreshWeighIns,
      createWeighIn,
      deleteWeighIn,
      chatMessages,
      chatSending,
      sendChatMessage,
      retryLastMessage,
      stopGenerating,
    }),
    [
      summary,
      summaryLoading,
      summaryError,
      refreshSummary,
      settings,
      settingsLoading,
      updateSettings,
      meals,
      mealsLoading,
      refreshMeals,
      createMeal,
      updateMeal,
      deleteMeal,
      transactions,
      transactionsLoading,
      refreshTransactions,
      createTransaction,
      updateTransaction,
      deleteTransaction,
      weighIns,
      weighInsLoading,
      refreshWeighIns,
      createWeighIn,
      deleteWeighIn,
      chatMessages,
      chatSending,
      sendChatMessage,
      retryLastMessage,
      stopGenerating,
    ],
  );

  return <TrackerStoreContext.Provider value={value}>{children}</TrackerStoreContext.Provider>;
}

export function useTrackerStore(): TrackerStoreValue {
  const ctx = useContext(TrackerStoreContext);
  if (!ctx) throw new Error("useTrackerStore must be used within a TrackerStoreProvider");
  return ctx;
}

export { DEFAULT_SESSION_ID };
