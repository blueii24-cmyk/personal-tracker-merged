export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * This endpoint belongs to the hosting-template health check, not the tracker.
 * The tracker stores/syncs records through its local-first service and optional
 * Supabase client; it does not require the template's DATABASE_URL to build.
 *
 * Load the optional Postgres client only when this endpoint is actually called,
 * so a missing DATABASE_URL cannot crash Next.js while collecting route data.
 */
export async function GET() {
  if (!process.env.DATABASE_URL) {
    return Response.json(
      { ok: false, database: "not_configured" },
      { status: 503 },
    );
  }

  try {
    const [{ db }, { sql }] = await Promise.all([
      import("@/db"),
      import("drizzle-orm"),
    ]);
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, database: "connected" });
  } catch {
    return Response.json(
      { ok: false, database: "unavailable" },
      { status: 503 },
    );
  }
}
