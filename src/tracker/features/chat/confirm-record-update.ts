/** Explicit approval is required for every AI-proposed update of an existing record. */
export function confirmRecordUpdate(kind: string, before: unknown, after: unknown): boolean {
  if (typeof globalThis.confirm !== 'function') return false;
  try {
    return globalThis.confirm(`The assistant wants to update this ${kind}. Editing a chat message does not change records.\n\nCurrent:\n${JSON.stringify(before, null, 2)}\n\nProposed:\n${JSON.stringify(after, null, 2)}\n\nApply this change?`);
  } catch {
    return false;
  }
}
