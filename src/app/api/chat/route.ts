import { interpretMessage, type DemoIntent } from "@/lib/chat/engine";
import { appendChatMessage, applyOperation, getSnapshot, aiStatus, StoreError } from "@/server/store";
import type { TrackerOperation } from "@/server/compat/api";
import type { ChatActionResult, Meal, Transaction, WeighIn } from "@/types/domain";
import { toClientCreated } from "@/server/compat/client-adapter";
import { privateModeGuard } from "@/server/private-mode";

export const dynamic = "force-dynamic";

function intentToOperation(intent: DemoIntent): TrackerOperation {
  switch (intent.kind) {
    case "meal": return { op: "createMeal", input: intent.input };
    case "transaction": return { op: "createTransaction", input: intent.input };
    case "transactionUpdate": return { op: "updateTransaction", id: intent.transactionId, input: intent.input };
    case "weighIn": return { op: "saveWeighIn", input: intent.input };
  }
}

function actionFromCreated(created: ReturnType<typeof toClientCreated>): ChatActionResult | undefined {
  if (!created) return undefined;
  if (created.kind === "meal") {
    return { kind: "meal-logged", title: "Meal logged", mock: false, meal: created.record as Meal };
  }
  if (created.kind === "transaction") {
    const transaction = created.record as Transaction;
    return {
      kind: transaction.type === "income" ? "income-logged" : "expense-logged",
      title: transaction.type === "income" ? "Income recorded" : "Expense recorded",
      mock: false,
      transaction,
    };
  }
  return { kind: "weight-logged", title: "Weight recorded", mock: false, weighIn: created.record as WeighIn };
}

export async function POST(request: Request) {
  const blocked = privateModeGuard();
  if (blocked) return blocked;

  let body: unknown;
  try { body = await request.json(); }
  catch { return Response.json({ error: { code: "validation", message: "Invalid request body." } }, { status: 400 }); }

  const payload = body as { content?: unknown; sessionId?: unknown };
  const content = typeof payload.content === "string" ? payload.content.trim() : "";
  const sessionId = typeof payload.sessionId === "string" && payload.sessionId ? payload.sessionId.slice(0, 100) : "default-session";

  if (!content) return Response.json({ error: { code: "validation", message: "Type a message before sending." } }, { status: 422 });
  if (content.length > 2000) return Response.json({ error: { code: "validation", message: "Messages must be 2,000 characters or fewer." } }, { status: 422 });

  try {
    const before = await getSnapshot();
    await appendChatMessage({ sessionId, role: "user", content });
    const outcome = interpretMessage(content, before, before.today);
    let reply = outcome.reply;
    let action: ChatActionResult | undefined;

    if (outcome.intent) {
      try {
        const result = await applyOperation(intentToOperation(outcome.intent));
        action = actionFromCreated(toClientCreated(result.created));
        if (!action) reply = "I couldn't confirm that the change was saved, so nothing has been marked as recorded. Please try again.";
      } catch (error) {
        const reason = error instanceof StoreError ? error.message : "The workspace could not save that change.";
        reply = `I couldn't save that: ${reason} Nothing was recorded. Try again, or add it manually from the tracker pages.`;
      }
    }

    await appendChatMessage({ sessionId, role: "assistant", content: reply, attachment: action ? { kind: action.kind === "meal-logged" ? "meal" : action.kind === "weight-logged" ? "weighIn" : "transaction", id: action.meal?.id ?? action.transaction?.id ?? action.weighIn?.id ?? "" } : null });
    return Response.json({ reply, action, mode: aiStatus().mode }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[chat] failed", error);
    return Response.json({ error: { code: "server", message: "The assistant could not respond. Your message was not saved — please retry." } }, { status: 500 });
  }
}
