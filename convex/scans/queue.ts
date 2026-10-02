"use node";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import { v } from "convex/values";

// Queue admission, separated from analyzeScan so the browser can poll a
// position without starting a second analysis. MAX_CONCURRENT_ANALYSES lives in
// convex/scans/quota.ts and is 6: at about 4 GitHub requests per scan that is
// roughly 24 of an hour's quota in flight, and it keeps every action short.
export const joinQueue = action({
  args: { scanId: v.id("scans"), owner: v.string(), repo: v.string() },
  returns: v.object({
    position: v.number(),
    running: v.number(),
    limit: v.number(),
    started: v.boolean(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ position: number; running: number; limit: number; started: boolean }> => {
    const slot = await ctx.runMutation(internal.scans.quota.claimSlot, {
      scanId: args.scanId,
      owner: args.owner,
      repo: args.repo,
      now: Date.now(),
    });
    return {
      position: slot.position,
      running: slot.running,
      limit: slot.limit,
      started: slot.position === 0,
    };
  },
});

export const leaveQueue = action({
  args: { scanId: v.id("scans") },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.runMutation(internal.scans.quota.releaseSlot, { scanId: args.scanId });
    return null;
  },
});