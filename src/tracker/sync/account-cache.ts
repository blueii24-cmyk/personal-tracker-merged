/** Removes this device's cached copy of one account (records, sync bookkeeping, merge safety copies). */
export function purgeAccountCache(userId: string, prefix = ''): void {
  try {
    const doomed: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && (k.startsWith(`${prefix}pt.acct.${userId}.`) || k.startsWith(`${prefix}pt.sync.${userId}.`) || k.startsWith(`${prefix}pt.merge.backup.${userId}.`))) doomed.push(k);
    }
    for (const k of doomed) localStorage.removeItem(k);
  } catch {
    /* nothing more can be done */
  }
}
