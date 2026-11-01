/** App-wide constants. Change APP_NAME to rename the product everywhere. */
export const APP_NAME = 'Personal Tracker';
export const APP_SHORT_NAME = 'Tracker';

/** Browser-safe backend configuration. Only the URL and publishable key ever reach the client. */
export const SUPABASE_URL: string = (process.env.NEXT_PUBLIC_SUPABASE_URL ?? '').trim();
export const SUPABASE_PUBLISHABLE_KEY: string = (process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? '').trim();
export const isBackendConfigured: boolean = SUPABASE_URL.length > 0 && SUPABASE_PUBLISHABLE_KEY.length > 0;
export const AI_CHAT_PATH = '/functions/v1/ai-chat';
