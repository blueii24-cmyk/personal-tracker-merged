import { Capacitor, registerPlugin } from '@capacitor/core';

/** True only inside the Android app (Capacitor). Always false in a normal browser and during tests. */
export function isNative(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

/**
 * The key for the user's own AI provider, kept in Android Keystore-encrypted storage.
 * Implemented natively in android/app/src/main/java/com/blueii24/personaltracker/SecureKeyPlugin.java.
 * Only call these when `isNative()` is true.
 */
export interface SecureKeyPlugin {
  get(): Promise<{ value: string | null }>;
  set(options: { value: string }): Promise<void>;
  remove(): Promise<void>;
}
export const SecureKey = registerPlugin<SecureKeyPlugin>('SecureKey');
