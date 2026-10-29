import { db } from "@/db";
import { sql } from "drizzle-orm";

export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return Response.json({ ok: true, mode: "demo", database: "not-configured" });
  }
  try {
    await db.execute(sql`select 1`);
    return Response.json({ ok: true, mode: "database", database: "connected" });
  } catch {
    return Response.json({ ok: false, database: "unavailable" }, { status: 503 });
  }
}
