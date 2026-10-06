import { internalAction, internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { internal } from "../_generated/api";

// Retention for the analytics staging rows.
//
// This lives in its own module rather than at the bottom of rollup.ts for one
// reason that matters to the compiler: an action here calls a mutation in THIS
// module, and the generated api map types that call from the module's own type.
// Self-reference makes TypeScript give up on the module's inferred type, and the
// failure spreads across every file that uses the api. Split, the reference points
// at a different module and the inference holds.
//
// It is also its own module on purpose. A Convex mutation cannot call another
// mutation, so retention inside the fold would have meant either a duplicated
// delete loop or a day whose numbers depend on whether the delete half finished.

/** How long raw staging rows are kept before this window removes them. */
export const USAGE_EVENT_TTL_DAYS = 30;
// Written in whole units on purpose. The claim guard resolves a retention constant
// by evaluating the digits in it, so a value written as `USAGE_EVENT_TTL_DAYS * ...`
// is invisible to it, and copy stating this window then reads as unsupported. The
// two constants are held together by a test rather than by hope.
export const USAGE_EVENT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// One purge deletes at most this many rows. When the bound is reached the result
// says so, so a backlog is visible instead of silently half cleared.
const PURGE_BATCH = 500;

export const purgeUsageEvents = internalMutation({
  args: { olderThan: v.number() },
  returns: v.object({
    deleted: v.number(),
    hitBatchCap: v.boolean(),
    cutoffDay: v.string(),
  }),
  handler: async (ctx, args) => {
    const cutoffDay = new Date(args.olderThan).toISOString().slice(0, 10);
    const stale = await ctx.db
      .query("usageEvents")
      .withIndex("by_day", (q) => q.lt("day", cutoffDay))
      .order("asc")
      .take(PURGE_BATCH);
    for (const row of stale) await ctx.db.delete("usageEvents", row._id);
    return {
      deleted: stale.length,
      hitBatchCap: stale.length === PURGE_BATCH,
      cutoffDay,
    };
  },
});

/**
 * The scheduled half of retention, and an action rather than a mutation.
 *
 * That is the reason. The cutoff has to be computed when the job fires. A cron
 * argument is frozen when the module loads, so `Date.now() - TTL` written into the
 * registration in crons.ts is one fixed instant forever: a year after deploy it
 * would delete every row in the table. An action runs at fire time, so the cutoff
 * below is the cutoff at the moment the job actually runs.
 *
 * The folded metrics are never deleted. They are the only table a reader touches,
 * they hold no repository name, and this window is the only bound they have.
 */
/** How long raw visitor ids are kept before this window removes them. */
export const VISITOR_ID_TTL_DAYS = 30;
// Same whole-unit rule as above: the claim guard reads the digits, so the
// multiplier stays written out and the copy can quote 30 days truthfully.
export const VISITOR_ID_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export const purgeVisitorDays = internalMutation({
  args: { olderThan: v.number() },
  returns: v.object({
    deleted: v.number(),
    hitBatchCap: v.boolean(),
    cutoffDay: v.string(),
  }),
  handler: async (ctx, args) => {
    const cutoffDay = new Date(args.olderThan).toISOString().slice(0, 10);
    const stale = await ctx.db
      .query("visitorDays")
      .withIndex("by_day", (q) => q.lt("day", cutoffDay))
      .order("asc")
      .take(PURGE_BATCH);
    for (const row of stale) await ctx.db.delete("visitorDays", row._id);
    return {
      deleted: stale.length,
      hitBatchCap: stale.length === PURGE_BATCH,
      cutoffDay,
    };
  },
});

export const purgeExpiredVisitorIds = internalAction({
  args: {},
  returns: v.object({
    deleted: v.number(),
    hitBatchCap: v.boolean(),
    cutoffDay: v.string(),
  }),
  handler: async (ctx): Promise<{
    deleted: number;
    hitBatchCap: boolean;
    cutoffDay: string;
  }> => {
    return await ctx.runMutation(internal.analytics.retention.purgeVisitorDays, {
      olderThan: Date.now() - VISITOR_ID_TTL_MS,
    });
  },
});

export const purgeExpiredUsageEvents = internalAction({
  args: {},
  returns: v.object({
    deleted: v.number(),
    hitBatchCap: v.boolean(),
    cutoffDay: v.string(),
  }),
  handler: async (ctx): Promise<{
    deleted: number;
    hitBatchCap: boolean;
    cutoffDay: string;
  }> => {
    return await ctx.runMutation(internal.analytics.retention.purgeUsageEvents, {
      olderThan: Date.now() - USAGE_EVENT_TTL_MS,
    });
  },
});