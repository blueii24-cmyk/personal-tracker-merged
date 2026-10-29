// Small shared helpers for the data-access layer. Centralising the "is a
// real backend configured" check here means every service/UI can rely on a
// single source of truth instead of guessing.

export const BACKEND_MODE: "demo" | "live" =
  process.env.NEXT_PUBLIC_BACKEND_MODE === "live" ? "live" : "demo";

export const isDemoMode = BACKEND_MODE === "demo";

/** Simulates realistic network latency for the in-memory demo service. */
export function simulateLatency(min = 180, max = 420): Promise<void> {
  const delay = Math.round(min + Math.random() * (max - min));
  return new Promise((resolve) => setTimeout(resolve, delay));
}

export function generateId(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}
