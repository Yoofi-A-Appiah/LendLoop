import { v } from "convex/values";
import { internalAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { signatureHeader } from "./lib/hmac";

const MAX_ATTEMPTS = 5;

/** Convex -> n8n: signed POST for a request status change. Retries with backoff, then records failure. */
export const notify = internalAction({
  args: { loanId: v.id("loans"), event: v.string(), attempt: v.number() },
  handler: async (ctx, { loanId, event, attempt }) => {
    const url = process.env.N8N_REQUEST_WEBHOOK_URL;
    const secret = process.env.LENDLOOP_TO_N8N_SECRET;
    const key = `notify:${loanId}:${event}`;
    const record = (status: "sent" | "failed", detail: string) =>
      ctx.runMutation(internal.loans.recordEvent, { key, loanId, kind: "notification", status, detail });

    if (!url || !secret) {
      await record("failed", "n8n webhook not configured");
      return;
    }
    const payload = await ctx.runQuery(internal.loans.notificationPayload, { loanId, event });
    if (!payload) return;

    const body = JSON.stringify(payload);
    let error: string;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json", "x-lendloop-signature": await signatureHeader(secret, body) },
        body,
      });
      // n8n answers 200 with an empty body if the workflow crashes before its Respond node,
      // so only an explicit {"ok":true} counts as delivered.
      const ack = res.ok ? await res.json().catch(() => null) : null;
      if (ack?.ok === true) {
        await record("sent", `Notified ${payload.recipient.name} (${event})`);
        return;
      }
      error = res.ok ? "n8n workflow did not acknowledge" : `HTTP ${res.status}`;
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }

    if (attempt < MAX_ATTEMPTS) {
      const delayMs = 2 ** attempt * 15_000; // 30s, 1m, 2m, 4m
      await ctx.scheduler.runAfter(delayMs, internal.n8n.notify, { loanId, event, attempt: attempt + 1 });
      console.warn(`n8n notify ${key} attempt ${attempt} failed (${error}); retrying in ${delayMs / 1000}s`);
    } else {
      console.error(`n8n notify ${key} gave up after ${attempt} attempts: ${error}`);
      await record("failed", `Notification failed after ${attempt} attempts: ${error}`);
    }
  },
});
