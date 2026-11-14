import type { NextConfig } from "next";

// `node scripts/build-android-web.mjs` sets NEXT_BUILD_TARGET=android to produce the static files that are bundled
// into the Android app (folder `out/`). The normal web build (`npm run build`) is unchanged.
const isAndroidBuild = process.env.NEXT_BUILD_TARGET === "android";
const allowedDevOrigins = (process.env.ALLOWED_DEV_ORIGINS ?? "").split(",").map((origin) => origin.trim()).filter(Boolean);

const nextConfig: NextConfig = isAndroidBuild
  ? {
      output: "export",
      distDir: "out",
      images: { unoptimized: true },
      allowedDevOrigins,
    }
  : { allowedDevOrigins };

export default nextConfig;
