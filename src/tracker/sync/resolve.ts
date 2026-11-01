/**
 * The conflict policy, as one pure function.
 *
 * Both sides changed the same record since they last agreed. Rules, in order:
 *  1. Same content            → nothing to do.
 *  2. One side deleted it     → the EDIT wins (never lose content because of a delete); flagged for review.
 *  3. Both sides edited it    → the later change wins (`updatedAt`, a device clock); an exact tie goes to the cloud copy.
 * The losing version is never discarded: the engine keeps it as a visible conflict entry the user can restore.
 */
export interface Side {
  /** Canonical JSON, or null when that side deleted the record. */
  json: string | null;
  updatedAt: string;
}
export type Resolution =
  | { action: 'same' }
  | { action: 'keep-local'; reason: 'edit-vs-delete' | 'newer-local' }
  | { action: 'take-remote'; reason: 'edit-vs-delete' | 'newer-remote' | 'tie-cloud-wins' };

export function resolveConflict(local: Side, remote: Side): Resolution {
  if (local.json === remote.json) return { action: 'same' };
  if (local.json === null) return { action: 'take-remote', reason: 'edit-vs-delete' };
  if (remote.json === null) return { action: 'keep-local', reason: 'edit-vs-delete' };
  const l = Date.parse(local.updatedAt);
  const r = Date.parse(remote.updatedAt);
  if (l > r) return { action: 'keep-local', reason: 'newer-local' };
  if (r > l) return { action: 'take-remote', reason: 'newer-remote' };
  return { action: 'take-remote', reason: 'tie-cloud-wins' };
}
