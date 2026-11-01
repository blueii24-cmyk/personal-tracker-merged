/**
 * Browser-safe Supabase client. Only the project URL and the PUBLISHABLE (anon) key are ever used here; both are public
 * by design and protected by Row Level Security. The service-role/secret key must never be put in this app.
 * Returns null when the variables are absent, which keeps the app in plain local mode.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { isBackendConfigured, SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '@/tracker/config';

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!isBackendConfigured) return null;
  client ??= createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true, flowType: 'pkce' },
  });
  return client;
}
