"use node";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { validateLiveUrl } from "../../shared/ssrf";
import { canReadScan } from "../../shared/reports/scanAccess";
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
    // The caller's account, read the way the report queries read it. This lane
    // writes, so it answers to the same rule they enforce on the read: a scan id
    // is an address, not a permission.
    const viewer = await getAuthUserId(ctx);
    const scan = await ctx.runQuery(internal.scans.store.fetchScan, { scanId: args.scanId });
    // One sentence for a scan that is missing and for a scan the caller does not
    // own. Two answers would let anyone holding an id learn which ids exist, and
    // this lane runs before the URL is even looked at, so nothing is written and
    // nothing is fetched when the caller may not read the row. A guest scan of a
    // public repo stays readable by id, which is what canReadScan defines, and the
    // owner's signed-in scan stays writable.
    const mayRead = scan !== null && canReadScan(scan, viewer);
    if (!mayRead) throw new Error("That scan is not available to your account. Sign in with the account that made it, then try again.");
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
