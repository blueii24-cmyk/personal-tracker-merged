import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { validateAndroidBuildEnv, verifyAndroidAssets } from '../../../../scripts/android-ci.mjs';

const ROOT = join(import.meta.dirname, '../../../..');
const publicConfig = {
  NEXT_PUBLIC_SUPABASE_URL: 'https://unit-test.invalid',
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'unit-test-publishable-key-not-a-credential',
};
const signingConfig = {
  ANDROID_UPLOAD_KEYSTORE_BASE64: Buffer.from('synthetic-test-keystore').toString('base64'),
  ANDROID_KEYSTORE_PASSWORD: 'synthetic-test-password',
  ANDROID_KEY_ALIAS: 'upload',
  ANDROID_KEY_PASSWORD: 'synthetic-test-password',
};
const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('Android CI public configuration preflight', () => {
  it('requires both public Supabase values for every cloud-enabled Android mode', () => {
    for (const mode of ['debug', 'release', 'bundle']) {
      const errors = validateAndroidBuildEnv({ ...signingConfig }, mode).join('\n');
      expect(errors).toContain('NEXT_PUBLIC_SUPABASE_URL is required');
      expect(errors).toContain('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is required');
    }
  });

  it('accepts public config without an auth redirect and keeps signing optional for debug', () => {
    expect(validateAndroidBuildEnv(publicConfig, 'debug')).toEqual([]);
    expect(validateAndroidBuildEnv({ ...publicConfig, NEXT_PUBLIC_AUTH_REDIRECT_URL: 'https://app.example/' }, 'debug')).toEqual([]);
  });

  it('requires repository variables for Supabase without step-level overrides', () => {
    const workflow = readFileSync(join(ROOT, '.github/workflows/android-build.yml'), 'utf8');
    for (const key of ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY']) {
      expect(workflow).toContain(key + ': ${{ vars.' + key + ' }}');
      expect(workflow.split(key + ':')).toHaveLength(2);
    }
    expect(workflow).toContain('run: node scripts/android-ci.mjs preflight');
  });

  it('rejects server credentials and malformed public settings without echoing their values', () => {
    const secret = 'sb_secret_unit_test_credential_that_must_never_ship';
    const errors = validateAndroidBuildEnv({
      NEXT_PUBLIC_SUPABASE_URL: 'not a url',
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: secret,
      NEXT_PUBLIC_AUTH_REDIRECT_URL: 'javascript:alert(1)',
    }, 'debug');
    expect(errors.some((error) => error.includes('must not contain a secret key'))).toBe(true);
    expect(errors.some((error) => error.includes('not a valid absolute URL'))).toBe(true);
    expect(errors.some((error) => error.includes('NEXT_PUBLIC_AUTH_REDIRECT_URL'))).toBe(true);
    expect(errors.join('\n')).not.toContain(secret);
    expect(errors.join('\n')).not.toContain('not a url');
  });

  it('requires complete signing inputs only for release and bundle', () => {
    expect(validateAndroidBuildEnv({ ...publicConfig, ...signingConfig }, 'release')).toEqual([]);
    expect(validateAndroidBuildEnv({ ...publicConfig, ...signingConfig }, 'bundle')).toEqual([]);
    const errors = validateAndroidBuildEnv(publicConfig, 'bundle').join('\n');
    expect(errors).toContain('ANDROID_UPLOAD_KEYSTORE_BASE64 is required');
    expect(errors).toContain('ANDROID_KEYSTORE_PASSWORD is required');
    expect(errors).toContain('ANDROID_KEY_ALIAS is required');
    expect(errors).toContain('ANDROID_KEY_PASSWORD is required');
  });
});

describe('packaged Android asset verification', () => {
  it('checks the exact public values without exposing them in a failure', () => {
    const dir = mkdtempSync(join(tmpdir(), 'personal-tracker-assets-'));
    tempDirs.push(dir);
    mkdirSync(join(dir, '_next'), { recursive: true });
    writeFileSync(join(dir, '_next', 'app.js'), `const config=${JSON.stringify(publicConfig)}`);
    expect(() => verifyAndroidAssets(dir, publicConfig)).not.toThrow();
    expect(() => verifyAndroidAssets(dir, { ...publicConfig, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: 'different-unit-test-publishable-key' }))
      .toThrowError('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY did not reach the packaged Android assets');
  });
});

describe('Android native presentation and identity remain scoped', () => {
  it('uses NoActionBar for the base theme without changing launch/status-bar themes', () => {
    const styles = readFileSync(join(ROOT, 'android/app/src/main/res/values/styles.xml'), 'utf8');
    expect(styles).not.toContain('DarkActionBar');
    expect(styles).toContain('name="AppTheme" parent="AppTheme.NoActionBar"');
    expect(styles).toContain('name="AppTheme.NoActionBarLaunch"');
    expect(styles).toContain('android:statusBarColor');
  });

  it('retains the existing application ID, launcher label, activity themes, and launch mode', () => {
    const manifest = readFileSync(join(ROOT, 'android/app/src/main/AndroidManifest.xml'), 'utf8');
    const gradle = readFileSync(join(ROOT, 'android/app/build.gradle'), 'utf8');
    expect(manifest).toContain('android:label="@string/app_name"');
    expect(manifest).toContain('android:icon="@mipmap/ic_launcher"');
    expect(manifest).toContain('android:theme="@style/AppTheme.NoActionBarLaunch"');
    expect(manifest).toContain('android:launchMode="singleTask"');
    expect(manifest).toContain('android:name=".MainActivity"');
    expect(gradle).toContain('applicationId "com.blueii24.personaltracker"');
    const capacitor = readFileSync(join(ROOT, 'capacitor.config.ts'), 'utf8');
    expect(capacitor).toContain('appId: "com.blueii24.personaltracker"');
    expect(capacitor).toContain('appName: "Personal Tracker"');
    expect(capacitor).not.toMatch(/^\s*(?:androidScheme|hostname)\s*:/m); // retain Capacitor's default https://localhost origin
    expect(capacitor).toContain('allowMixedContent: false');
  });
});
