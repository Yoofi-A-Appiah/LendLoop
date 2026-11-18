import { defineSchema, defineTable } from "convex/server";
import { v } from "convex/values";

export const CATEGORIES = ["power tools", "hand tools", "garden", "kitchen", "camping", "cleaning", "other"] as const;
export const category = v.union(...CATEGORIES.map((c) => v.literal(c)));
export const loanStatus = v.union(
  v.literal("pending"),
  v.literal("approved"),
  v.literal("declined"),
  v.literal("cancelled"),
  v.literal("returned"),
);

export default defineSchema({
  users: defineTable({
    tokenIdentifier: v.string(),
    name: v.string(),
    email: v.string(),
    role: v.union(v.literal("admin"), v.literal("user")),
    trusted: v.boolean(),
  })
    .index("by_token", ["tokenIdentifier"])
    .index("by_email", ["email"]),

  tools: defineTable({
    ownerId: v.id("users"),
    name: v.string(),
    category,
    condition: v.string(),
    description: v.string(),
  })
    .index("by_owner", ["ownerId"])
    .index("by_category", ["category"]),

  loans: defineTable({
    toolId: v.id("tools"),
    toolName: v.string(), // snapshot so history survives tool deletion
    ownerId: v.id("users"),
    borrowerId: v.id("users"),
    startDate: v.string(), // YYYY-MM-DD
    endDate: v.string(),
    status: loanStatus,
  })
    .index("by_tool", ["toolId"])
    .index("by_owner", ["ownerId"])
    .index("by_borrower", ["borrowerId"])
    .index("by_status_end", ["status", "endDate"]),

  // Everything n8n/Convex automation did. `key` makes write-backs idempotent.
  automationEvents: defineTable({
    key: v.string(),
    loanId: v.optional(v.id("loans")),
    kind: v.union(v.literal("notification"), v.literal("reminder"), v.literal("workflow_error")),
    status: v.union(v.literal("sent"), v.literal("failed")),
    detail: v.string(),
    at: v.number(),
  })
    .index("by_key", ["key"])
    .index("by_loan", ["loanId", "at"]),
});
