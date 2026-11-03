/** Exact Android callback used for PKCE signup confirmation and password recovery. */
export const NATIVE_AUTH_REDIRECT_URL = 'com.blueii24.personaltracker://auth/callback';

export function preferredAuthRedirect(native: boolean, fixedWebUrl: string, webOrigin?: string): string | undefined {
  if (native) return NATIVE_AUTH_REDIRECT_URL;
  const fixed = fixedWebUrl.trim();
  return fixed || webOrigin;
}

export interface AuthCallback {
  code: string;
  recovery: boolean;
}

/**
 * Only the app's own callback is accepted. Implicit-flow tokens and unrelated
 * deep links are deliberately ignored; the configured Supabase flow is PKCE.
 */
export function parseAuthCallback(raw: string): { callback?: AuthCallback; error?: string } | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  if (url.protocol !== 'com.blueii24.personaltracker:' || url.host !== 'auth' || url.pathname !== '/callback') return null;
  const providerError = url.searchParams.get('error');
  if (providerError) return { error: 'The sign-in link was not completed. Request a new link and try again.' };
  const code = url.searchParams.get('code');
  if (!code) return { error: 'This sign-in link is incomplete. Request a new link and try again.' };
  return { callback: { code, recovery: url.searchParams.get('type') === 'recovery' } };
}
