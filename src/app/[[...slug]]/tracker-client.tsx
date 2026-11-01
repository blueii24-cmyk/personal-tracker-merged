"use client";

import dynamic from "next/dynamic";

// The tracker is a browser-only app (React Router + localStorage), so it is never rendered on the server.
const App = dynamic(() => import("@/tracker/app/App"), { ssr: false });

export function TrackerClient() {
  return <App />;
}
