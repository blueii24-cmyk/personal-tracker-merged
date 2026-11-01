#!/usr/bin/env node
/**
 * One command for the Android build.
 *   node scripts/android.mjs debug     -> android/app/build/outputs/apk/debug/app-debug.apk (installable test build)
 *   node scripts/android.mjs release   -> release APK (signed only if android/keystore.properties exists)
 *   node scripts/android.mjs bundle    -> android/app/build/outputs/bundle/release/app-release.aab (for Google Play)
 *   node scripts/android.mjs sync      -> only rebuild the web bundle and copy it into the Android project
 * Needs JDK 21 (JAVA_HOME) and the Android SDK (ANDROID_HOME, with platform 36 and build-tools 36.0.0).
 */
import { spawnSync } from "node:child_process";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const target = process.argv[2] ?? "debug";
const tasks = { debug: "assembleDebug", release: "assembleRelease", bundle: "bundleRelease" };
if (target !== "sync" && !tasks[target]) {
  console.error("Usage: node scripts/android.mjs <debug|release|bundle|sync>");
  process.exit(1);
}

const run = (cmd, args, cwd = root) => {
  const r = spawnSync(cmd, args, { cwd, stdio: "inherit", env: process.env, shell: process.platform === "win32" });
  if (r.status !== 0) process.exit(r.status ?? 1);
};

run("node", ["scripts/build-android-web.mjs"]);
run("npx", ["cap", "sync", "android"]);
if (target === "sync") process.exit(0);

const sdk = process.env.ANDROID_HOME || process.env.ANDROID_SDK_ROOT;
if (!sdk) {
  console.error("Set ANDROID_HOME to your Android SDK folder (or open the android/ folder in Android Studio once).");
  process.exit(1);
}
const local = resolve(root, "android/local.properties");
if (!existsSync(local)) writeFileSync(local, `sdk.dir=${sdk.replace(/\\/g, "/")}\n`);

const gradle = process.platform === "win32" ? "gradlew.bat" : "./gradlew";
run(gradle, [tasks[target]], resolve(root, "android"));
console.log(`\nDone: ${target}`);
