/**
 * The imported Sonnet database store is a single-workspace store, not a
 * multi-user authenticated backend. Never expose it from a production build.
 * Enable only for private local development until proper auth/RLS is added.
 */
export function privateModeGuard(): Response | null {
  if (process.env.NODE_ENV === "production") {
    return Response.json(
      { error: { code: "unavailable", message: "Database routes require authenticated multi-user access before production use." } },
      { status: 403 },
    );
  }
  if (process.env.TRACKER_PRIVATE_SINGLE_USER !== "true" || !process.env.DATABASE_URL) {
    return Response.json(
      { error: { code: "unavailable", message: "Private database mode is disabled. Configure DATABASE_URL and TRACKER_PRIVATE_SINGLE_USER=true for local development, or use demo mode." } },
      { status: 503 },
    );
  }
  return null;
}
