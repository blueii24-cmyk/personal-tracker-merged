import { describe, expect, it } from 'vitest';
import { NATIVE_AUTH_REDIRECT_URL, parseAuthCallback, preferredAuthRedirect } from './callback';

describe('native auth callback', () => {
  it('uses the native callback even when a production web redirect is built in', () => {
    expect(preferredAuthRedirect(true, 'https://personal-tracker-merged.vercel.app', 'https://localhost')).toBe(NATIVE_AUTH_REDIRECT_URL);
    expect(preferredAuthRedirect(false, ' https://example.com ', 'https://other.example')).toBe('https://example.com');
    expect(preferredAuthRedirect(false, '', 'https://other.example')).toBe('https://other.example');
  });

  it('accepts only the exact PKCE callback and identifies recovery', () => {
    expect(parseAuthCallback(`${NATIVE_AUTH_REDIRECT_URL}?code=abc123`)).toEqual({ callback: { code: 'abc123', recovery: false } });
    expect(parseAuthCallback(`${NATIVE_AUTH_REDIRECT_URL}?code=abc123&type=recovery`)).toEqual({ callback: { code: 'abc123', recovery: true } });
  });

  it('ignores unrelated deep links and rejects malformed or provider-error callbacks', () => {
    expect(parseAuthCallback('https://example.com/auth/callback?code=abc')).toBeNull();
    expect(parseAuthCallback('com.blueii24.personaltracker://other/callback?code=abc')).toBeNull();
    expect(parseAuthCallback('not a url')).toBeNull();
    expect(parseAuthCallback(`${NATIVE_AUTH_REDIRECT_URL}?error=access_denied`)?.error).toBeTruthy();
    expect(parseAuthCallback(NATIVE_AUTH_REDIRECT_URL)?.error).toBeTruthy();
    expect(parseAuthCallback(`${NATIVE_AUTH_REDIRECT_URL}#access_token=secret`)?.error).toBeTruthy();
  });
});
