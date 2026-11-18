import { v } from "convex/values";
import { internalMutation, mutation, query } from "./_generated/server";
import { currentUser, requireAdmin } from "./lib/auth";

/** Called by the client after sign-in. Creates/refreshes the profile; never touches role/trusted. */
export const store = mutation({
  args: {},
  handler: async (ctx) => {
    const identity = await ctx.auth.getUserIdentity();
    if (!identity) throw new Error("Not signed in");
    const name = identity.name ?? identity.nickname ?? identity.email ?? "Neighbor";
    const email = identity.email ?? "";
    const existing = await currentUser(ctx);
    if (existing) {
      if (existing.name !== name || existing.email !== email) await ctx.db.patch(existing._id, { name, email });
      return existing._id;
    }
    return ctx.db.insert("users", {
      tokenIdentifier: identity.tokenIdentifier,
      name,
      email,
      role: "user",
      trusted: false,
    });
  },
});

export const me = query({ args: {}, handler: (ctx) => currentUser(ctx) });

export const list = query({
  args: {},
  handler: async (ctx) => {
    await requireAdmin(ctx);
    return ctx.db.query("users").collect();
  },
});

export const setTrusted = mutation({
  args: { userId: v.id("users"), trusted: v.boolean() },
  handler: async (ctx, { userId, trusted }) => {
    await requireAdmin(ctx);
    await ctx.db.patch(userId, { trusted });
  },
});

/** Not callable from clients. Bootstrap admins with:
 *  npx convex run users:setRole '{"email":"you@example.com","role":"admin"}' */
export const setRole = internalMutation({
  args: { email: v.string(), role: v.union(v.literal("admin"), v.literal("user")) },
  handler: async (ctx, { email, role }) => {
    const user = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", email)).unique();
    if (!user) throw new Error(`No user with email ${email} (sign in once first)`);
    await ctx.db.patch(user._id, { role });
  },
});
