#!/usr/bin/env node
/**
 * Builds the static web bundle that is packaged into the Android app (output: ./out).
 *
 * Tracker records remain local-first; optional hosted services use Supabase directly. Next.js API routes used by the
 * hosting preview/BYOK web relay can't be included in a static export, so they are moved aside for the build and always restored.
 */
import { spawnSync } from "node:child_process";
import { existsSync, renameSync, rmSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const api = resolve(root, "src/app/api");
const stash = resolve(root, ".android-build-stash-api");

if (existsSync(stash)) {
  console.error(`Found ${stash} from an interrupted build. Move it back to src/app/api, then run again.`);
  process.exit(1);
}

rmSync(resolve(root, "out"), { recursive: true, force: true });

let status = 1;
const hadApi = existsSync(api);
try {
  if (hadApi) renameSync(api, stash);
  const r = spawnSync("npx", ["next", "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NEXT_BUILD_TARGET: "android", NEXT_TELEMETRY_DISABLED: "1" },
  });
  status = r.status ?? 1;
} finally {
  if (hadApi && existsSync(stash)) renameSync(stash, api);
}

if (status !== 0) process.exit(status);
if (!existsSync(resolve(root, "out/index.html"))) {
  console.error("Static export finished but out/index.html is missing.");
  process.exit(1);
}
console.log("Android web bundle ready in ./out");
