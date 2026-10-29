"use client";

import type { ReactNode } from "react";
import { ThemeProvider } from "@/providers/ThemeProvider";
import { ToastProvider } from "@/providers/ToastProvider";
import { TrackerStoreProvider } from "@/store/TrackerStoreProvider";

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider>
      <ToastProvider>
        <TrackerStoreProvider>{children}</TrackerStoreProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
