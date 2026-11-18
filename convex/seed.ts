import { v } from "convex/values";
import { internalMutation, type MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { CATEGORIES } from "./schema";

// Demo data for development. Internal only:
//   npx convex run seed:run               (adds neighbors, tools, loans)
//   npx convex run seed:clear             (removes everything seed:run created)
// Seeded people use example.com addresses and "seed|" token identifiers, so they can never sign in.

type Category = (typeof CATEGORIES)[number];

const NEIGHBORS = [
  { key: "ama", name: "Ama Mensah", trusted: false },
  { key: "kwesi", name: "Kwesi Boateng", trusted: true },
  { key: "priya", name: "Priya Nair", trusted: false },
  { key: "tom", name: "Tom Becker", trusted: true },
  { key: "lena", name: "Lena Ortiz", trusted: false },
] as const;
type Key = (typeof NEIGHBORS)[number]["key"];

const TOOLS: [Key, string, Category, string, string][] = [
  ["kwesi", "Pressure washer", "cleaning", "Good", "2000 PSI, 10m hose, patio cleaner attachment."],
  ["kwesi", "Hedge trimmer", "garden", "Like new", "Cordless 36V, one battery lasts about an hour."],
  ["kwesi", "Mitre saw", "power tools", "Good", "10-inch blade. Please bring your own clamps."],
  ["kwesi", "Socket set", "hand tools", "Well used", "Metric and imperial, a couple of sockets missing."],
  ["ama", "4-person tent", "camping", "Good", "Pitches in 10 minutes. Comes with footprint and spare pegs."],
  ["ama", "Camp stove", "camping", "Like new", "Twin burner, uses standard gas canisters (not included)."],
  ["ama", "Stand mixer", "kitchen", "Good", "Dough hook, whisk and paddle."],
  ["ama", "Wheelbarrow", "garden", "Fair", "Tyre needs a bit of air now and then."],
  ["priya", "Pasta machine", "kitchen", "Like new", "Hand-crank, three cutter widths."],
  ["priya", "Carpet cleaner", "cleaning", "Good", "Upright, includes upholstery tool. Bring your own solution."],
  ["priya", "Cool box", "camping", "Good", "45L, keeps ice two days in the shade."],
  ["priya", "Tile cutter", "hand tools", "Good", "Manual, cuts up to 60cm."],
  ["priya", "Slow cooker", "kitchen", "Fair", "6L, lid has a small chip but seals fine."],
  ["tom", "3m ladder", "other", "Good", "Aluminium extension ladder. Two people to carry."],
  ["tom", "Jigsaw", "power tools", "Good", "Variable speed, assorted blades in the case."],
  ["tom", "Orbital sander", "power tools", "Like new", "With dust bag and 20 sheets of mixed grit."],
  ["tom", "Spirit level", "hand tools", "Like new", "120cm, magnetic edge."],
  ["tom", "Gazebo", "other", "Good", "3x3m pop-up, sides included. Great for street parties."],
  ["lena", "Leaf blower", "garden", "Good", "Electric, 10m cable."],
  ["lena", "Loppers", "garden", "Well used", "Long-handled, sharpened last spring."],
  ["lena", "Steam mop", "cleaning", "Good", "Two washable pads."],
  ["lena", "Lantern", "camping", "Like new", "Rechargeable LED, USB-C."],
  ["lena", "Sack truck", "other", "Good", "Folds flat, takes up to 150kg."],
  ["lena", "Circular saw", "power tools", "Fair", "Guard is a little stiff but works."],
];

const day = (offset: number) => {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offset);
  return d.toISOString().slice(0, 10);
};

async function seedUsers(ctx: MutationCtx) {
  return ctx.db
    .query("users")
    .collect()
    .then((all) => all.filter((u) => u.tokenIdentifier.startsWith("seed|")));
}

export const run = internalMutation({
  args: { you: v.optional(v.string()) }, // your email; adds requests involving you so every view has content
  handler: async (ctx, { you }) => {
    if ((await seedUsers(ctx)).length) return "Already seeded. Run seed:clear first to start over.";

    const ids = {} as Record<Key, Id<"users">>;
    for (const n of NEIGHBORS) {
      ids[n.key] = await ctx.db.insert("users", {
        tokenIdentifier: `seed|${n.key}`,
        name: n.name,
        email: `${n.key}@example.com`,
        role: "user",
        trusted: n.trusted,
      });
    }

    const toolIds: Record<string, Id<"tools">> = {};
    for (const [owner, name, category, condition, description] of TOOLS) {
      toolIds[name] = await ctx.db.insert("tools", { ownerId: ids[owner], name, category, condition, description });
    }

    const loan = async (tool: string, ownerId: Id<"users">, borrowerId: Id<"users">, start: number, end: number, status: "pending" | "approved" | "returned") =>
      ctx.db.insert("loans", { toolId: toolIds[tool], toolName: tool, ownerId, borrowerId, startDate: day(start), endDate: day(end), status });
    const event = (key: string, loanId: Id<"loans">, kind: "notification" | "reminder", detail: string, hoursAgo: number) =>
      ctx.db.insert("automationEvents", { key, loanId, kind, status: "sent", detail, at: Date.now() - hoursAgo * 3_600_000 });

    // Overdue: shows the reminder trail and the overdue state.
    const overdue = await loan("Pressure washer", ids.kwesi, ids.priya, -8, -3, "approved");
    await event(`notify:${overdue}:request.approved`, overdue, "notification", "Notified Priya Nair (request.approved)", 24 * 9);
    await event(`reminder:${overdue}:${day(-1)}`, overdue, "reminder", "Overdue reminder sent (2d late)", 24);
    // Out now.
    const out = await loan("4-person tent", ids.ama, ids.tom, -1, 3, "approved");
    await event(`notify:${out}:request.approved`, out, "notification", "Notified Tom Becker (request.approved)", 30);
    // Booked for later, so the day grid shows hatched days.
    await loan("3m ladder", ids.tom, ids.lena, 4, 6, "approved");
    // Waiting for an answer.
    const pending = await loan("Gazebo", ids.tom, ids.ama, 7, 8, "pending");
    await event(`notify:${pending}:request.created`, pending, "notification", "Notified Tom Becker (request.created)", 3);
    // History.
    await loan("Stand mixer", ids.ama, ids.kwesi, -20, -18, "returned");

    let note = "";
    if (you) {
      const me = await ctx.db.query("users").withIndex("by_email", (q) => q.eq("email", you)).unique();
      if (!me) note = ` (no user with email ${you}; skipped your requests)`;
      else {
        const mine = await ctx.db.query("tools").withIndex("by_owner", (q) => q.eq("ownerId", me._id)).first();
        if (mine) {
          // A neighbor wants your tool: fills "Waiting for your answer".
          const ask = await ctx.db.insert("loans", { toolId: mine._id, toolName: mine.name, ownerId: me._id, borrowerId: ids.lena, startDate: day(2), endDate: day(4), status: "pending" });
          await event(`notify:${ask}:request.created`, ask, "notification", `Notified ${me.name} (request.created)`, 1);
        }
        // You're borrowing: approved, so the lender's email is revealed.
        const borrow = await loan("Hedge trimmer", ids.kwesi, me._id, 1, 2, "approved");
        await event(`notify:${borrow}:request.approved`, borrow, "notification", `Notified ${me.name} (request.approved)`, 5);
      }
    }
    return `Seeded ${NEIGHBORS.length} neighbors, ${TOOLS.length} tools and their loans${note}.`;
  },
});

export const clear = internalMutation({
  args: {},
  handler: async (ctx) => {
    const seeded = new Set((await seedUsers(ctx)).map((u) => u._id));
    let loans = 0;
    for (const l of await ctx.db.query("loans").collect()) {
      if (!seeded.has(l.ownerId) && !seeded.has(l.borrowerId)) continue;
      for (const e of await ctx.db.query("automationEvents").withIndex("by_loan", (q) => q.eq("loanId", l._id)).collect()) await ctx.db.delete(e._id);
      await ctx.db.delete(l._id);
      loans++;
    }
    let tools = 0;
    for (const t of await ctx.db.query("tools").collect()) if (seeded.has(t.ownerId)) { await ctx.db.delete(t._id); tools++; }
    for (const id of seeded) await ctx.db.delete(id);
    return `Removed ${seeded.size} neighbors, ${tools} tools, ${loans} loans.`;
  },
});
