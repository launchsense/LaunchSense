import { internalQuery, mutation, query } from "../_generated/server";
import type { MutationCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

// Server-only GitHub token for the signed-in archive download.
// Public functions return a boolean or nothing. They never return the token.

export async function writeScanToken(
  ctx: MutationCtx,
  userId: Id<"users">,
  accessToken: string,
): Promise<void> {
  const existing = await ctx.db
    .query("githubScanTokens")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  const updatedAt = Date.now();
  if (existing === null) {
    await ctx.db.insert("githubScanTokens", { userId, accessToken, updatedAt });
    return;
  }
  await ctx.db.patch("githubScanTokens", existing._id, { accessToken, updatedAt });
}

export async function deleteScanToken(ctx: MutationCtx, userId: Id<"users">): Promise<void> {
  const existing = await ctx.db
    .query("githubScanTokens")
    .withIndex("by_user", (q) => q.eq("userId", userId))
    .unique();
  if (existing !== null) await ctx.db.delete("githubScanTokens", existing._id);
}

export const readScanToken = internalQuery({
  args: { userId: v.id("users") },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const row = await ctx.db
      .query("githubScanTokens")
      .withIndex("by_user", (q) => q.eq("userId", args.userId))
      .unique();
    if (row === null || row.accessToken.length === 0) return null;
    return row.accessToken;
  },
});

export const hasGitHubToken = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return false;
    const row = await ctx.db
      .query("githubScanTokens")
      .withIndex("by_user", (q) => q.eq("userId", userId))
      .unique();
    return row !== null && row.accessToken.length > 0;
  },
});

export const clearMyGitHubToken = mutation({
  args: {},
  returns: v.null(),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return null;
    await deleteScanToken(ctx, userId);
    return null;
  },
});
