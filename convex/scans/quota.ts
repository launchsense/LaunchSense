import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

// Admission control. MAX_CONCURRENT_ANALYSES is deliberately small: one scan is
// roughly 4 GitHub requests, so 6 concurrent scans is about 24 requests of the
// 5000 an hour a token gives, and it keeps every visitor inside a short action.
const MAX_CONCURRENT_ANALYSES = 6;
const STALE_RUNNING_MS = 180000;

export const claimSlot = internalMutation({
  args: { scanId: v.id("scans"), owner: v.string(), repo: v.string(), now: v.number() },
  // position is 0 when the caller may start immediately.
  returns: v.object({ position: v.number(), running: v.number(), limit: v.number() }),
  handler: async (ctx, args) => {
    const waiting = await ctx.db
      .query("scanQueue")
      .withIndex("by_queue", (q) => q.eq("startedAt", 0))
      .order("asc")
      .take(200);

    // A running entry older than the stale window is from a crashed action.
    const live = waiting.filter(
      (w) => w.startedAt === 0 || w.startedAt > args.now - STALE_RUNNING_MS,
    );
    const running = live.filter((w) => w.startedAt !== 0).length;

    const mine = live.findIndex((w) => w.scanId === args.scanId);
    if (mine !== -1 && live[mine]?.startedAt === 0) {
      if (running < MAX_CONCURRENT_ANALYSES) {
        await ctx.db.patch("scanQueue", live[mine]._id, { startedAt: args.now });
        return { position: 0, running: running + 1, limit: MAX_CONCURRENT_ANALYSES };
      }
      return {
        position: live.filter((w) => w.startedAt === 0).indexOf(live[mine]) + 1,
        running,
        limit: MAX_CONCURRENT_ANALYSES,
      };
    }

    if (mine === -1) {
      const entry = {
        scanId: args.scanId,
        owner: args.owner,
        repo: args.repo,
        queuedAt: args.now,
      };
      if (running < MAX_CONCURRENT_ANALYSES) {
        await ctx.db.insert("scanQueue", { ...entry, startedAt: args.now });
        return { position: 0, running: running + 1, limit: MAX_CONCURRENT_ANALYSES };
      }
      // Waiting entry: startedAt 0 marks it as not yet started.
      await ctx.db.insert("scanQueue", { ...entry, startedAt: 0 });
      const ahead = live.filter((w) => w.startedAt === 0).length;
      return { position: ahead + 1, running, limit: MAX_CONCURRENT_ANALYSES };
    }

    return { position: 0, running, limit: MAX_CONCURRENT_ANALYSES };
  },
});

export const releaseSlot = internalMutation({
  args: { scanId: v.id("scans") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const all = await ctx.db.query("scanQueue").order("desc").take(500);
    const mine = all.find((r) => r.scanId === args.scanId);
    if (mine !== undefined) await ctx.db.delete("scanQueue", mine._id);
    return null;
  },
});

export const queueStats = internalQuery({
  args: {},
  returns: v.object({
    waiting: v.number(),
    running: v.number(),
    limit: v.number(),
    positionOf: v.optional(v.number()),
  }),
  handler: async (ctx) => {
    const all = await ctx.db.query("scanQueue").order("asc").take(500);
    const now = Date.now();
    const waiting = all.filter((r) => r.startedAt === 0).length;
    const running = all.filter(
      (r) => r.startedAt !== 0 && r.startedAt > now - STALE_RUNNING_MS,
    ).length;
    return { waiting, running, limit: MAX_CONCURRENT_ANALYSES };
  },
});

// The browser reads this to show remaining quota and the reset time.
export const getQuota = internalQuery({
  args: {},
  returns: v.union(
    v.object({
      remaining: v.number(),
      limit: v.number(),
      resetAt: v.number(),
      updatedAt: v.number(),
      scansPerHour: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    const rows = await ctx.db
      .query("quotaState")
      .withIndex("by_updated", (q) => q.gte("updatedAt", 0))
      .order("desc")
      .take(1);
    const row = rows[0] ?? null;
    if (row === null) return null;
    // A scan costs roughly 4 GitHub requests with the tarball path.
    const scansPerHour = Math.max(0, Math.floor(row.remaining / 4));
    return {
      remaining: row.remaining,
      limit: row.limit,
      resetAt: row.resetAt,
      updatedAt: row.updatedAt,
      scansPerHour,
    };
  },
});

export const recordQuota = internalMutation({
  args: { remaining: v.number(), limit: v.number(), resetAt: v.number(), now: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("quotaState")
      .withIndex("by_updated", (q) => q.gte("updatedAt", 0))
      .order("desc")
      .take(1);
    const doc = {
      remaining: args.remaining,
      limit: args.limit,
      resetAt: args.resetAt,
      updatedAt: args.now,
    };
    if (rows[0] !== undefined) {
      await ctx.db.patch("quotaState", rows[0]._id, doc);
    } else {
      await ctx.db.insert("quotaState", doc);
    }
    // Keep only the newest row. Older mirrors are noise.
    const stale = await ctx.db
      .query("quotaState")
      .withIndex("by_updated", (q) => q.lt("updatedAt", args.now))
      .order("desc")
      .take(50);
    for (const row of stale) await ctx.db.delete("quotaState", row._id);
    return null;
  },
});