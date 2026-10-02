"use node";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { validateLiveUrl } from "../../shared/ssrf";
import { fetchLiveSite } from "../adapters/live";

export const checkLive = action({
  args: {
    scanId: v.id("scans"),
    url: v.string(),
    mainAction: v.optional(v.string()),
  },
  returns: v.object({
    scanId: v.id("scans"),
    reaches: v.boolean(),
    httpStatus: v.union(v.number(), v.null()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ scanId: Id<"scans">; reaches: boolean; httpStatus: number | null }> => {
    const scan = await ctx.runQuery(internal.scans.store.fetchScan, { scanId: args.scanId });
    if (scan === null) throw new Error("Scan was not found.");
    const mainAction = (args.mainAction ?? "").slice(0, 140);
    const parsed = validateLiveUrl(args.url);
    if (!parsed.ok) throw new Error(parsed.error);

    await ctx.runMutation(internal.scans.store.setLiveInputs, {
      scanId: args.scanId,
      liveUrl: parsed.url,
      mainAction: mainAction.length > 0 ? mainAction : undefined,
      now: Date.now(),
    });

    const result = await fetchLiveSite(parsed.url, mainAction);
    await ctx.runMutation(internal.scans.store.saveLiveCheck, {
      scanId: args.scanId,
      url: parsed.url,
      finalUrl: result.finalUrl ?? undefined,
      https: result.https,
      reaches: result.reaches,
      httpStatus: result.httpStatus ?? undefined,
      nonBlank: result.nonBlank ?? undefined,
      mainActionFound: result.mainActionFound ?? undefined,
      viewportMeta: result.viewportMeta ?? undefined,
      hops: result.hops,
      errorKind: result.error !== null ? "network" : undefined,
      errorMessage: result.error ?? undefined,
      checkedAt: Date.now(),
    });
    return { scanId: args.scanId, reaches: result.reaches, httpStatus: result.httpStatus };
  },
});
