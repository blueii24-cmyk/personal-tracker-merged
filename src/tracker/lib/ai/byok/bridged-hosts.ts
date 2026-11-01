/**
 * Providers that cannot be called directly from a browser because they do not
 * provide CORS headers. Keep this list narrow: it is also the proxy allow-list.
 */
export const BRIDGED_HOSTS: ReadonlySet<string> = new Set(['integrate.api.nvidia.com']);
export const BRIDGED_PATHS: ReadonlySet<string> = new Set(['/v1/models', '/v1/chat/completions']);
export const PROXY_PATH = '/api/ai-proxy';
export const PROXY_TARGET_HEADER = 'x-proxy-target';
export const PROXY_MARK = 'x-ai-proxy';

export function isBridgedHost(url: string): boolean {
  try {
    const target = new URL(url);
    return target.protocol === 'https:' && BRIDGED_HOSTS.has(target.hostname);
  } catch {
    return false;
  }
}
