import { httpRouter } from "convex/server";
import { httpAction, type ActionCtx } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { verifySignature } from "./lib/hmac";
import { today } from "./lib/auth";

const json = (data: unknown, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json" } });

/** n8n -> Convex: every request must carry a valid, fresh HMAC of the raw body. */
async function signedBody(req: Request): Promise<{ ok: true; body: Record<string, unknown> } | { ok: false; res: Response }> {
  const secret = process.env.N8N_TO_LENDLOOP_SECRET;
  if (!secret) return { ok: false, res: json({ error: "not configured" }, 500) };
  const raw = await req.text();
  if (!(await verifySignature(secret, raw, req.headers.get("x-lendloop-signature")))) {
    return { ok: false, res: json({ error: "invalid signature" }, 401) };
  }
  try {
    return { ok: true, body: raw ? JSON.parse(raw) : {} };
  } catch {
    return { ok: false, res: json({ error: "invalid json" }, 400) };
  }
}

async function loanIdOrNull(ctx: ActionCtx, raw: unknown) {
  if (typeof raw !== "string") return null;
  return ctx.runQuery(internal.loans.normalizeLoanId, { id: raw });
}

const http = httpRouter();

http.route({
  path: "/n8n/overdue-loans",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const r = await signedBody(req);
    if (!r.ok) return r.res;
    const day = today();
    return json({ day, loans: await ctx.runQuery(internal.loans.overdue, { day }) });
  }),
});

http.route({
  path: "/n8n/reminder-status",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const r = await signedBody(req);
    if (!r.ok) return r.res;
    const { idempotencyKey, status, detail } = r.body;
    const loanId = await loanIdOrNull(ctx, r.body.loanId);
    if (!loanId || typeof idempotencyKey !== "string" || !idempotencyKey.startsWith(`reminder:${loanId}:`)) {
      return json({ error: "bad loanId/idempotencyKey" }, 400);
    }
    if (status !== "sent" && status !== "failed") return json({ error: "bad status" }, 400);
    const result = await ctx.runMutation(internal.loans.recordEvent, {
      key: idempotencyKey,
      loanId: loanId as Id<"loans">,
      kind: "reminder",
      status,
      detail: typeof detail === "string" ? detail.slice(0, 300) : status === "sent" ? "Overdue reminder sent" : "Reminder failed",
    });
    return json({ ok: true, ...result });
  }),
});

/** Called by the n8n error workflow so failed runs show up in the admin view. */
http.route({
  path: "/n8n/workflow-error",
  method: "POST",
  handler: httpAction(async (ctx, req) => {
    const r = await signedBody(req);
    if (!r.ok) return r.res;
    const { executionId, workflow, message } = r.body;
    if (typeof executionId !== "string" && typeof executionId !== "number") return json({ error: "bad executionId" }, 400);
    await ctx.runMutation(internal.loans.recordEvent, {
      key: `workflow_error:${executionId}`,
      kind: "workflow_error",
      status: "failed",
      detail: `${String(workflow ?? "workflow")}: ${String(message ?? "unknown error")}`.slice(0, 300),
    });
    return json({ ok: true });
  }),
});

export default http;
