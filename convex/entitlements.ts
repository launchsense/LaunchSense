import { internalMutation, query } from "./_generated/server";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";

export const getMyEntitlements = query({
  args: {},
  returns: v.array(
    v.object({
      featureKey: v.literal("rendered_phone_check"),
      enabled: v.boolean(),
      source: v.union(v.literal("paid"), v.literal("permitted")),
      expiresAt: v.optional(v.number()),
      grantedBy: v.string(),
      updatedAt: v.number(),
    }),
  ),
  handler: async (ctx) => {
    const userId = await getAuthUserId(ctx);
    if (userId === null) return [];
    return ctx.db
      .query("featureEntitlements")
      .withIndex("by_user_feature", (q) => q.eq("userId", userId))
      .collect();
  },
});

export const grant = internalMutation({
  args: {
    userId: v.id("users"),
    featureKey: v.literal("rendered_phone_check"),
    source: v.union(v.literal("paid"), v.literal("permitted")),
    expiresAt: v.optional(v.number()),
    grantedBy: v.string(),
    now: v.number(),
  },
  returns: v.id("featureEntitlements"),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("featureEntitlements")
      .withIndex("by_user_feature", (q) =>
        q.eq("userId", args.userId).eq("featureKey", args.featureKey),
      )
      .unique();
    if (existing !== null) {
      await ctx.db.patch("featureEntitlements", existing._id, {
        enabled: true,
        source: args.source,
        expiresAt: args.expiresAt,
        grantedBy: args.grantedBy,
        updatedAt: args.now,
      });
      return existing._id;
    }
    return ctx.db.insert("featureEntitlements", {
      userId: args.userId,
      featureKey: args.featureKey,
      enabled: true,
      source: args.source,
      expiresAt: args.expiresAt,
      grantedBy: args.grantedBy,
      updatedAt: args.now,
    });
  },
});

export const revoke = internalMutation({
  args: {
    userId: v.id("users"),
    featureKey: v.literal("rendered_phone_check"),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("featureEntitlements")
      .withIndex("by_user_feature", (q) =>
        q.eq("userId", args.userId).eq("featureKey", args.featureKey),
      )
      .unique();
    if (existing !== null) {
      await ctx.db.patch("featureEntitlements", existing._id, {
        enabled: false,
        updatedAt: args.now,
      });
    }
    return null;
  },
});