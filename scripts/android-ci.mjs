#!/usr/bin/env node
/** CI-only validation for Android public configuration, signing inputs, and packaged web assets. */
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const ANDROID_BUILD_MODES = ['debug', 'release', 'bundle'];
const PUBLIC_KEYS = ['NEXT_PUBLIC_SUPABASE_URL', 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY'];
const SIGNING_KEYS = ['ANDROID_UPLOAD_KEYSTORE_BASE64', 'ANDROID_KEYSTORE_PASSWORD', 'ANDROID_KEY_ALIAS', 'ANDROID_KEY_PASSWORD'];

const value = (env, key) => (env[key] ?? '').trim();
const looksPlaceholder = (text) => /YOUR-|CHANGE_ME|PASTE_|<[A-Z_]+>|PROJECT-REF/i.test(text);

function validatePublicConfig(env, errors) {
  for (const key of PUBLIC_KEYS) {
    if (!value(env, key)) errors.push(`${key} is required. Add it under GitHub repository Settings → Secrets and variables → Actions → Variables.`);
  }
  const supabaseUrl = value(env, 'NEXT_PUBLIC_SUPABASE_URL');
  if (supabaseUrl) {
    try {
      const parsed = new URL(supabaseUrl);
      if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.search || parsed.hash) {
        errors.push('NEXT_PUBLIC_SUPABASE_URL must be an HTTPS project URL without credentials, query parameters, or fragments.');
      }
    } catch {
      errors.push('NEXT_PUBLIC_SUPABASE_URL is not a valid absolute URL. Use the Project URL from the intended Supabase project.');
    }
  }
  const publishableKey = value(env, 'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY');
  if (publishableKey) {
    if (publishableKey.length < 20 || /\s/.test(publishableKey) || looksPlaceholder(publishableKey)) {
      errors.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY is empty, too short, or still a placeholder. Use the project publishable (or legacy anon) key.');
    }
    if (/^sb_secret_/i.test(publishableKey)) {
      errors.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY must not contain a secret key. Replace it with the publishable key immediately.');
    }
    if (publishableKey.split('.').length === 3) {
      try {
        const payload = JSON.parse(Buffer.from(publishableKey.split('.')[1], 'base64url').toString('utf8'));
        if (payload.role === 'service_role') errors.push('NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY contains a service-role JWT. Replace it with the anon/publishable key immediately.');
      } catch {
        // Non-JWT publishable keys are valid; the other checks still apply.
      }
    }
  }
  const redirect = value(env, 'NEXT_PUBLIC_AUTH_REDIRECT_URL');
  if (redirect) {
    try {
      if (new URL(redirect).protocol !== 'https:') errors.push('NEXT_PUBLIC_AUTH_REDIRECT_URL must be an HTTPS web URL so email confirmation/recovery can finish in the browser.');
    } catch {
      errors.push('NEXT_PUBLIC_AUTH_REDIRECT_URL is optional, but when set it must be a valid absolute HTTPS web URL.');
    }
  }
}

/** Return actionable errors only; never include environment values. */
export function validateAndroidBuildEnv(env, mode) {
  const errors = [];
  if (!ANDROID_BUILD_MODES.includes(mode)) errors.push(`ANDROID_BUILD_MODE must be one of: ${ANDROID_BUILD_MODES.join(', ')}.`);
  validatePublicConfig(env, errors);
  if (mode === 'release' || mode === 'bundle') {
    for (const key of SIGNING_KEYS) {
      if (!value(env, key)) errors.push(`${key} is required for ${mode}. Add it under GitHub repository Settings → Secrets and variables → Actions → Secrets.`);
    }
    const encoded = value(env, 'ANDROID_UPLOAD_KEYSTORE_BASE64').replace(/\s/g, '');
    if (encoded) {
      if (!/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) || encoded.length % 4 === 1) {
        errors.push('ANDROID_UPLOAD_KEYSTORE_BASE64 is not valid base64. Encode the existing upload keystore without printing its contents.');
      } else if (Buffer.from(encoded, 'base64').length === 0) {
        errors.push('ANDROID_UPLOAD_KEYSTORE_BASE64 decodes to an empty file.');
      }
    }
  }
  return errors;
}

function assetFiles(root) {
  const files = [];
  const visit = (dir) => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      const stat = statSync(path);
      if (stat.isDirectory()) visit(path);
      else if (/\.(?:js|mjs|html|json)$/i.test(entry)) files.push(path);
    }
  };
  visit(root);
  return files;
}

/** Verify the exact public values reached the packaged assets, without printing either value. */
export function verifyAndroidAssets(directory, env) {
  const errors = [];
  validatePublicConfig(env, errors);
  if (errors.length) throw new Error(errors.join('\n'));
  const root = resolve(directory);
  if (!existsSync(root)) throw new Error(`Android web asset directory is missing: ${root}`);
  const files = assetFiles(root);
  if (!files.length) throw new Error('No JavaScript/HTML/JSON assets were found in the Android package.');
  const contents = files.map((file) => readFileSync(file, 'utf8'));
  for (const key of PUBLIC_KEYS) {
    const expected = value(env, key);
    if (!contents.some((text) => text.includes(expected))) {
      throw new Error(`${key} did not reach the packaged Android assets. Check the build environment; its value was not logged.`);
    }
  }
}

const isCli = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (isCli) {
  const [command, directory] = process.argv.slice(2);
  try {
    if (command === 'preflight') {
      const mode = (process.env.ANDROID_BUILD_MODE ?? 'debug').trim();
      const errors = validateAndroidBuildEnv(process.env, mode);
      if (errors.length) {
        console.error(`Android ${mode} preflight failed:`);
        for (const error of errors) console.error(`- ${error}`);
        process.exit(1);
      }
      console.log(`Android ${mode} configuration preflight passed (values withheld).`);
    } else if (command === 'verify-assets' && directory) {
      verifyAndroidAssets(directory, process.env);
      console.log('Exact public Supabase configuration verified in Android assets (values withheld).');
    } else {
      console.error('Usage: node scripts/android-ci.mjs preflight | node scripts/android-ci.mjs verify-assets <asset-directory>');
      process.exit(1);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'Android CI validation failed.');
    process.exit(1);
  }
}
