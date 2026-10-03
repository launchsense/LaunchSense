import { query, mutation } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const listForUser = query({
  args: {},
  returns: v.array(
    v.object({
      _id: v.id("projects"),
      owner: v.string(),
      repo: v.string(),
      connectedAt: v.number(),
      lastScanAt: v.optional(v.number()),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect()
      .then((rows) =>
        rows.map((r) => ({
          _id: r._id,
          owner: r.owner,
          repo: r.repo,
          connectedAt: r.connectedAt,
          lastScanAt: r.lastScanAt,
        })),
      );
  },
});

export const upsert = mutation({
  args: {
    owner: v.string(),
    repo: v.string(),
  },
  returns: v.id("projects"),
  handler: async (ctx, args) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) throw new Error("Sign in first.");
    const existing = await ctx.db
      .query("projects")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .collect();
    const match = existing.find((p) => p.owner === args.owner && p.repo === args.repo);
    if (match) return match._id;
    return ctx.db.insert("projects", {
      userId,
      owner: args.owner,
      repo: args.repo,
      connectedAt: Date.now(),
    });
  },
});
