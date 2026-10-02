"use node";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { isPublicIdShape, newPublicId } from "../adapters/share";

export const createShare = action({
  args: { scanId: v.id("scans") },
  returns: v.object({ shareId: v.string(), scanId: v.id("scans") }),
  handler: async (ctx, args): Promise<{ shareId: string; scanId: Id<"scans"> }> => {
    const scan = await ctx.runQuery(internal.scans.store.fetchScan, { scanId: args.scanId });
    if (scan === null || scan.analyzedAt === undefined) {
      throw new Error("Analyze the scan before sharing it.");
    }
    let shareId = newPublicId();
    if (!isPublicIdShape(shareId)) throw new Error("Could not create a share link. Try again.");
    const taken = await ctx.runQuery(internal.scans.store.findShare, { shareId });
    if (taken !== null) {
      shareId = newPublicId();
      if (!isPublicIdShape(shareId)) throw new Error("Could not create a share link. Try again.");
    }
    await ctx.runMutation(internal.scans.store.saveShare, {
      shareId,
      scanId: args.scanId,
      now: Date.now(),
    });
    return { shareId, scanId: args.scanId };
  },
});

export const createPassport = action({
  args: { scanId: v.id("scans") },
  returns: v.object({ passportId: v.string(), scanId: v.id("scans") }),
  handler: async (ctx, args): Promise<{ passportId: string; scanId: Id<"scans"> }> => {
    const scan = await ctx.runQuery(internal.scans.store.fetchScan, { scanId: args.scanId });
    if (scan === null || scan.analyzedAt === undefined) {
      throw new Error("Analyze the scan before issuing a passport.");
    }
    const passportId = newPublicId();
    if (!isPublicIdShape(passportId)) throw new Error("Could not issue a passport. Try again.");
    await ctx.runMutation(internal.scans.store.savePassport, {
      passportId,
      scanId: args.scanId,
      now: Date.now(),
    });
    return { passportId, scanId: args.scanId };
  },
});
