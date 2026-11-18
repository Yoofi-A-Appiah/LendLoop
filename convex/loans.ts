import { ConvexError, v } from "convex/values";
import { internalMutation, internalQuery, mutation, query, type MutationCtx, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { internal } from "./_generated/api";
import { requireAdmin, requireUser, today } from "./lib/auth";

export type NotifyEvent = "request.created" | "request.approved" | "request.declined" | "request.cancelled" | "loan.returned";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

async function loansForTool(ctx: QueryCtx, toolId: Id<"tools">) {
  return ctx.db.query("loans").withIndex("by_tool", (q) => q.eq("toolId", toolId)).collect();
}

export async function activeLoan(ctx: QueryCtx, toolId: Id<"tools">, day: string) {
  return (await loansForTool(ctx, toolId)).find((l) => l.status === "approved" && l.startDate <= day) ?? null;
}

async function assertNoOverlap(ctx: QueryCtx, toolId: Id<"tools">, start: string, end: string, ignore?: Id<"loans">) {
  const clash = (await loansForTool(ctx, toolId)).find(
    (l) => l._id !== ignore && l.status === "approved" && !(l.endDate < start || l.startDate > end),
  );
  if (clash) throw new ConvexError(`Already lent out ${clash.startDate} → ${clash.endDate}`);
}

function notify(ctx: MutationCtx, loanId: Id<"loans">, event: NotifyEvent) {
  return ctx.scheduler.runAfter(0, internal.n8n.notify, { loanId, event, attempt: 1 });
}

export async function cancelPendingForTool(ctx: MutationCtx, loans: Doc<"loans">[]) {
  for (const l of loans.filter((l) => l.status === "pending")) {
    await ctx.db.patch(l._id, { status: "cancelled" });
    await notify(ctx, l._id, "request.cancelled");
  }
}

async function getLoan(ctx: QueryCtx, loanId: Id<"loans">) {
  const loan = await ctx.db.get(loanId);
  if (!loan) throw new ConvexError("Request not found");
  return loan;
}

// ---------- mutations: each one checks the caller's relationship to the loan ----------

export const request = mutation({
  args: { toolId: v.id("tools"), startDate: v.string(), endDate: v.string() },
  handler: async (ctx, { toolId, startDate, endDate }) => {
    const me = await requireUser(ctx);
    const tool = await ctx.db.get(toolId);
    if (!tool) throw new ConvexError("Tool not found");
    if (tool.ownerId === me._id) throw new ConvexError("You can't borrow your own tool");
    if (!DATE.test(startDate) || !DATE.test(endDate)) throw new ConvexError("Dates must be YYYY-MM-DD");
    if (startDate < today()) throw new ConvexError("Start date is in the past");
    if (endDate < startDate) throw new ConvexError("End date is before start date");
    await assertNoOverlap(ctx, toolId, startDate, endDate);
    const loanId = await ctx.db.insert("loans", {
      toolId,
      toolName: tool.name,
      ownerId: tool.ownerId,
      borrowerId: me._id,
      startDate,
      endDate,
      status: "pending",
    });
    await notify(ctx, loanId, "request.created");
    return loanId;
  },
});

/** Lender approves or declines a pending request on their own tool. */
export const decide = mutation({
  args: { loanId: v.id("loans"), approve: v.boolean() },
  handler: async (ctx, { loanId, approve }) => {
    const me = await requireUser(ctx);
    const loan = await getLoan(ctx, loanId);
    if (loan.ownerId !== me._id) throw new ConvexError("Only the lender can decide");
    if (loan.status !== "pending") throw new ConvexError(`Request is already ${loan.status}`);
    if (approve) await assertNoOverlap(ctx, loan.toolId, loan.startDate, loan.endDate, loanId);
    await ctx.db.patch(loanId, { status: approve ? "approved" : "declined" });
    await notify(ctx, loanId, approve ? "request.approved" : "request.declined");
  },
});

/** Borrower withdraws their own pending request. */
export const cancel = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await getLoan(ctx, loanId);
    if (loan.borrowerId !== me._id) throw new ConvexError("Not your request");
    if (loan.status !== "pending") throw new ConvexError(`Request is already ${loan.status}`);
    await ctx.db.patch(loanId, { status: "cancelled" });
    await notify(ctx, loanId, "request.cancelled");
  },
});

/** Lender confirms the tool came back. */
export const markReturned = mutation({
  args: { loanId: v.id("loans") },
  handler: async (ctx, { loanId }) => {
    const me = await requireUser(ctx);
    const loan = await getLoan(ctx, loanId);
    if (loan.ownerId !== me._id) throw new ConvexError("Only the lender can mark a loan returned");
    if (loan.status !== "approved") throw new ConvexError("Only approved loans can be returned");
    await ctx.db.patch(loanId, { status: "returned" });
    await notify(ctx, loanId, "loan.returned");
  },
});

// ---------- views ----------

async function enrich(ctx: QueryCtx, loans: Doc<"loans">[]) {
  return Promise.all(
    loans.map(async (l) => {
      const [owner, borrower, events] = await Promise.all([
        ctx.db.get(l.ownerId),
        ctx.db.get(l.borrowerId),
        ctx.db.query("automationEvents").withIndex("by_loan", (q) => q.eq("loanId", l._id)).order("desc").take(3),
      ]);
      return {
        ...l,
        ownerName: owner?.name ?? "Unknown",
        borrowerName: borrower?.name ?? "Unknown",
        overdue: l.status === "approved" && l.endDate < today(),
        activity: events.map((e) => ({ kind: e.kind, status: e.status, detail: e.detail, at: e.at })),
      };
    }),
  );
}

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db.query("loans").withIndex("by_borrower", (q) => q.eq("borrowerId", me._id)).order("desc").collect();
    return enrich(ctx, loans);
  },
});

export const incoming = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    const loans = await ctx.db.query("loans").withIndex("by_owner", (q) => q.eq("ownerId", me._id)).order("desc").collect();
    return enrich(ctx, loans);
  },
});

export const all = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return enrich(ctx, await ctx.db.query("loans").order("desc").take(500));
  },
});

// ---------- internal: used by n8n notifier + HTTP endpoints ----------

/** Only the fields n8n needs to notify one person. */
export const notificationPayload = internalQuery({
  args: { loanId: v.id("loans"), event: v.string() },
  handler: async (ctx, { loanId, event }) => {
    const loan = await ctx.db.get(loanId);
    if (!loan) return null;
    const toOwner = event === "request.created" || event === "request.cancelled";
    const recipient = await ctx.db.get(toOwner ? loan.ownerId : loan.borrowerId);
    if (!recipient) return null;
    return {
      eventId: `${loanId}:${event}`, // stable: n8n dedupes on this
      event,
      loanId,
      recipient: { name: recipient.name, email: recipient.email },
      toolName: loan.toolName,
      startDate: loan.startDate,
      endDate: loan.endDate,
      status: loan.status,
    };
  },
});

/** Approved, past due, and not yet reminded today (so a retried run won't re-send). */
export const overdue = internalQuery({
  args: { day: v.string() },
  handler: async (ctx, { day }) => {
    const loans = await ctx.db
      .query("loans")
      .withIndex("by_status_end", (q) => q.eq("status", "approved").lt("endDate", day))
      .collect();
    const out = [];
    for (const l of loans) {
      const reminded = await ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("key", reminderKey(l._id, day))).unique();
      if (reminded?.status === "sent") continue;
      const borrower = await ctx.db.get(l.borrowerId);
      if (!borrower) continue;
      out.push({
        loanId: l._id,
        idempotencyKey: reminderKey(l._id, day),
        borrower: { name: borrower.name, email: borrower.email },
        toolName: l.toolName,
        endDate: l.endDate,
        daysOverdue: Math.round((Date.parse(day) - Date.parse(l.endDate)) / 86_400_000),
      });
    }
    return out;
  },
});

export const reminderKey = (loanId: Id<"loans">, day: string) => `reminder:${loanId}:${day}`;

/** Idempotent upsert keyed on `key`: retries update the same row instead of duplicating it. */
export const recordEvent = internalMutation({
  args: {
    key: v.string(),
    loanId: v.optional(v.id("loans")),
    kind: v.union(v.literal("notification"), v.literal("reminder"), v.literal("workflow_error")),
    status: v.union(v.literal("sent"), v.literal("failed")),
    detail: v.string(),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.query("automationEvents").withIndex("by_key", (q) => q.eq("key", args.key)).unique();
    if (existing) {
      if (existing.status === "sent") return { duplicate: true }; // never downgrade a success
      await ctx.db.patch(existing._id, { status: args.status, detail: args.detail, at: Date.now() });
      return { duplicate: false };
    }
    await ctx.db.insert("automationEvents", { ...args, at: Date.now() });
    return { duplicate: false };
  },
});

/** Validates an untrusted id string from n8n; null if it isn't a real loan id. */
export const normalizeLoanId = internalQuery({
  args: { id: v.string() },
  handler: async (ctx, { id }) => ctx.db.normalizeId("loans", id),
});

/** Admin: recent automation failures (failed notifications, reminders, n8n error-workflow reports). */
export const automationFailures = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    const recent = await ctx.db.query("automationEvents").order("desc").take(200);
    return recent.filter((e) => e.status === "failed").slice(0, 20);
  },
});
