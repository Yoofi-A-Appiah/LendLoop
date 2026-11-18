import { ConvexError, v } from "convex/values";
import { mutation, query, type QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { category } from "./schema";
import { requireUser, today } from "./lib/auth";
import { cancelPendingForTool, activeLoan, bookedRanges } from "./loans";

const fields = {
  name: v.string(),
  category,
  condition: v.string(),
  description: v.string(),
};

function clean(f: { name: string; condition: string; description: string }) {
  const name = f.name.trim(), condition = f.condition.trim(), description = f.description.trim();
  if (!name || name.length > 80) throw new ConvexError("Name must be 1–80 characters");
  if (!condition || condition.length > 40) throw new ConvexError("Condition must be 1–40 characters");
  if (description.length > 500) throw new ConvexError("Description must be under 500 characters");
  return { name, condition, description };
}

async function ownedTool(ctx: QueryCtx, toolId: Id<"tools">, user: Doc<"users">, allowAdmin: boolean) {
  const tool = await ctx.db.get(toolId);
  if (!tool) throw new ConvexError("Tool not found");
  if (tool.ownerId !== user._id && !(allowAdmin && user.role === "admin")) throw new ConvexError("Not your listing");
  return tool;
}

/** Public: tools available right now (not out on loan), name + category only. No owner details leave the server. */
export const listPublic = query({
  args: {},
  handler: async (ctx) => {
    const day = today();
    const out = new Set(
      (await ctx.db.query("loans").withIndex("by_status_end", (q) => q.eq("status", "approved")).collect())
        .filter((l) => l.startDate <= day)
        .map((l) => l.toolId),
    );
    const tools = await ctx.db.query("tools").order("desc").take(200);
    return tools.filter((t) => !out.has(t._id)).map((t) => ({ _id: t._id, name: t.name, category: t.category }));
  },
});

/** Signed-in board: all tools with availability, optional category filter. */
export const list = query({
  args: { category: v.optional(category) },
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    const tools = args.category
      ? await ctx.db.query("tools").withIndex("by_category", (q) => q.eq("category", args.category!)).collect()
      : await ctx.db.query("tools").order("desc").collect();
    // ponytail: per-tool lookups, fine for a neighborhood; paginate if listings reach the thousands
    return Promise.all(
      tools.map(async (t) => {
        const owner = await ctx.db.get(t.ownerId);
        const day = today();
        const [loan, booked] = await Promise.all([activeLoan(ctx, t._id, day), bookedRanges(ctx, t._id, day)]);
        return {
          ...t,
          ownerName: owner?.name ?? "Unknown",
          ownerTrusted: owner?.trusted ?? false,
          isMine: t.ownerId === me._id,
          onLoanUntil: loan?.endDate ?? null,
          booked,
        };
      }),
    );
  },
});

export const mine = query({
  args: {},
  handler: async (ctx) => {
    const me = await requireUser(ctx);
    return ctx.db.query("tools").withIndex("by_owner", (q) => q.eq("ownerId", me._id)).collect();
  },
});

export const create = mutation({
  args: fields,
  handler: async (ctx, args) => {
    const me = await requireUser(ctx);
    return ctx.db.insert("tools", { ownerId: me._id, category: args.category, ...clean(args) });
  },
});

export const update = mutation({
  args: { toolId: v.id("tools"), ...fields },
  handler: async (ctx, { toolId, ...args }) => {
    const me = await requireUser(ctx);
    await ownedTool(ctx, toolId, me, false); // admins remove, they don't edit others' listings
    await ctx.db.patch(toolId, { category: args.category, ...clean(args) });
  },
});

/** Owner, or admin, can remove. Blocked while the tool is out on an approved loan. */
export const remove = mutation({
  args: { toolId: v.id("tools") },
  handler: async (ctx, { toolId }) => {
    const me = await requireUser(ctx);
    await ownedTool(ctx, toolId, me, true);
    const loans = await ctx.db.query("loans").withIndex("by_tool", (q) => q.eq("toolId", toolId)).collect();
    if (loans.some((l) => l.status === "approved")) throw new ConvexError("Tool has an approved loan; mark it returned first");
    await cancelPendingForTool(ctx, loans);
    await ctx.db.delete(toolId);
  },
});
