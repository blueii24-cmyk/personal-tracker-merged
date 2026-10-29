import { getSnapshot } from "@/server/store";
import { toClientSnapshot } from "@/server/compat/client-adapter";
import { privateModeGuard } from "@/server/private-mode";

export const dynamic = "force-dynamic";

export async function GET() {
  const blocked = privateModeGuard();
  if (blocked) return blocked;
  try {
    const snapshot = await getSnapshot();
    return Response.json(toClientSnapshot(snapshot), {
      headers: { "Cache-Control": "no-store" },
    });
  } catch (error) {
    console.error("[tracker/state] failed", error);
    return Response.json(
      { error: { code: "server", message: "The tracker database is unavailable." } },
      { status: 503 },
    );
  }
}
