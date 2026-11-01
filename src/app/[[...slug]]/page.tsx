import { TrackerClient } from "./tracker-client";

// The Android build is a static export: one HTML file that boots the client-side router.
// (The normal server build still serves every path, so deep links like /budget keep working.)
export function generateStaticParams() {
  return [{ slug: [] }];
}

export default function Page() {
  return <TrackerClient />;
}
