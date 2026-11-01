/** Stable error codes. The first group matches the `ai-chat` Edge Function contract (BLUEPRINT.md §8). */
export type TrackerErrorCode =
  | 'UNAUTHENTICATED'
  | 'INVALID_REQUEST'
  | 'SESSION_NOT_FOUND'
  | 'RATE_LIMITED'
  | 'PROVIDER_UNAVAILABLE'
  | 'TOOL_VALIDATION_FAILED'
  | 'AI_KEY_MISSING'
  | 'AI_KEY_REJECTED'
  | 'AI_MODEL_NOT_FOUND'
  | 'INTERNAL_ERROR'
  // client-side only
  | 'NOT_FOUND'
  | 'VALIDATION'
  | 'NETWORK'
  | 'ABORTED'
  | 'NOT_IMPLEMENTED'
  | 'STORAGE_FAILED';

export class TrackerError extends Error {
  readonly code: TrackerErrorCode;
  readonly retryable: boolean;
  readonly requestId?: string;

  constructor(code: TrackerErrorCode, message: string, opts: { retryable?: boolean; requestId?: string } = {}) {
    super(message);
    this.name = 'TrackerError';
    this.code = code;
    this.retryable = opts.retryable ?? (code === 'NETWORK' || code === 'PROVIDER_UNAVAILABLE' || code === 'RATE_LIMITED');
    this.requestId = opts.requestId;
  }
}

export function isAbortError(e: unknown): boolean {
  return (e instanceof TrackerError && e.code === 'ABORTED') || (e instanceof DOMException && e.name === 'AbortError');
}

export function toTrackerError(e: unknown): TrackerError {
  if (e instanceof TrackerError) return e;
  if (isAbortError(e)) return new TrackerError('ABORTED', 'The request was cancelled.', { retryable: true });
  return new TrackerError('INTERNAL_ERROR', 'Something went wrong. Try again.', { retryable: true });
}
