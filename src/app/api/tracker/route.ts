import { applyOperation, getSnapshot, StoreError } from "@/server/store";
import type { TrackerOperationInput } from "@/types/api";
import { toClientCreated, toClientSnapshot, toServerOperation } from "@/server/compat/client-adapter";
import { privateModeGuard } from "@/server/private-mode";

export const dynamic = "force-dynamic";

const OPERATIONS = new Set([
  "createMeal", "updateMeal", "deleteMeal",
  "createTransaction", "updateTransaction", "deleteTransaction",
  "createWeighIn", "deleteWeighIn", "updateSettings",
]);

export async function POST(request: Request) {
  const blocked = privateModeGuard();
  if (blocked) return blocked;

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return Response.json({ error: { code: "validation", message: "Invalid request body." } }, { status: 400 });
  }

  if (!payload || typeof payload !== "object" || !("op" in payload) || typeof payload.op !== "string" || !OPERATIONS.has(payload.op)) {
    return Response.json({ error: { code: "validation", message: "Unknown operation." } }, { status: 400 });
  }
  const operationPayload = payload as { op: string; id?: unknown; input?: unknown };
  if (["createMeal", "updateMeal", "createTransaction", "updateTransaction", "createWeighIn", "updateSettings"].includes(operationPayload.op) && (!operationPayload.input || typeof operationPayload.input !== "object")) {
    return Response.json({ error: { code: "validation", message: "This operation requires an input object." } }, { status: 400 });
  }
  if (["updateMeal", "deleteMeal", "updateTransaction", "deleteTransaction", "deleteWeighIn"].includes(operationPayload.op) && (typeof operationPayload.id !== "string" || !operationPayload.id.trim())) {
    return Response.json({ error: { code: "validation", message: "A valid record ID is required." } }, { status: 400 });
  }

  try {
    const current = await getSnapshot();
    const operation = toServerOperation(payload as TrackerOperationInput, current);
    const result = await applyOperation(operation);
    return Response.json(
      { snapshot: toClientSnapshot(result.snapshot), created: toClientCreated(result.created) },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (error) {
    if (error instanceof StoreError) {
      const status = error.code === "validation" ? 422 : error.code === "not_found" ? 404 : 500;
      return Response.json({ error: { code: error.code, message: error.message } }, { status });
    }
    if (error instanceof Error && /not found/i.test(error.message)) {
      return Response.json({ error: { code: "not_found", message: error.message } }, { status: 404 });
    }
    if (error instanceof Error && error.message.startsWith("Invalid input:")) {
      return Response.json({ error: { code: "validation", message: error.message.replace(/^Invalid input:\s*/, "") } }, { status: 422 });
    }
    console.error("[tracker] operation failed", error);
    return Response.json(
      { error: { code: "server", message: "The tracker could not save that change." } },
      { status: 500 },
    );
  }
}
