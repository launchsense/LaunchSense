import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Decision-source monitoring. One read over stored fields, no new tracker.
//
// What this answers, and what it deliberately does not: it reports how often each
// rung of the decision lane answered, how often the lane fell back to the rule
// table, and how long the call took. It does not score any rung, does not compare
// a rung to the table's own order, and does not promote or retire a rung. Those
// need owner labels this table does not hold. A rung with zero rows here is
// unobserved, which is not the same as bad and not the same as good.
//
// The rows are usage diagnostics. They hold counts and a source name, never file
// text, so this query can be read without any disclosure rule.

const sourceCounts = v.object({
  source: v.string(),
  scans: v.number(),
});

export const decisionSourceDistribution = internalQuery({
  args: { days: v.optional(v.number()) },
  returns: v.object({
    // Every day in the window that had at least one row, oldest first.
    days: v.array(v.object({
      day: v.string(),
      total: v.number(),
      bySource: v.array(sourceCounts),
      // Rungs that were configured for a key but did not answer, counted from the
      // attempts the adapter recorded. Zero is a real zero, not a missing value.
      fallbackToTable: v.number(),
      medianDurationMs: v.number(),
      maxDurationMs: v.number(),
    })),
    // The whole window in one place, so a reader does not add up the days by hand.
    total: v.number(),
    totalsBySource: v.array(sourceCounts),
    fallbackToTable: v.number(),
    // Fields this table does not store, named so a reader does not go looking.
    notMeasured: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const days = Math.min(Math.max(args.days ?? 7, 1), 90);
    const since = Date.now() - days * 24 * 60 * 60 * 1000;

    const rows = await ctx.db
      .query("usageDiagnostics")
      .withIndex("by_day")
      .collect();

    const inWindow = rows.filter((row) => row.createdAt >= since);
    const byDay = new Map<string, typeof inWindow>();
    for (const row of inWindow) {
      const bucket = byDay.get(row.day);
      if (bucket === undefined) byDay.set(row.day, [row]);
      else bucket.push(row);
    }

    const ordered = [...byDay.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1));
    const dayBlocks = ordered.map(([day, bucket]) => {
      const sources = new Map<string, number>();
      let table = 0;
      const durations: number[] = [];
      for (const row of bucket) {
        sources.set(row.orderSource, (sources.get(row.orderSource) ?? 0) + 1);
        if (row.orderSource === "table") table += 1;
        durations.push(row.durationMs);
      }
      durations.sort((a, b) => a - b);
      const middle = Math.floor(durations.length / 2);
      return {
        day,
        total: bucket.length,
        bySource: [...sources.entries()]
          .map(([source, scans]) => ({ source, scans }))
          .sort((a, b) => b.scans - a.scans),
        fallbackToTable: table,
        medianDurationMs: durations.length % 2 === 0
          ? (durations[middle - 1] ?? 0) / 2 + (durations[middle] ?? 0) / 2
          : durations[middle] ?? 0,
        maxDurationMs: durations[durations.length - 1] ?? 0,
      };
    });

    const totalSources = new Map<string, number>();
    let totalTable = 0;
    for (const row of inWindow) {
      totalSources.set(row.orderSource, (totalSources.get(row.orderSource) ?? 0) + 1);
      if (row.orderSource === "table") totalTable += 1;
    }

    return {
      days: dayBlocks,
      total: inWindow.length,
      totalsBySource: [...totalSources.entries()]
        .map(([source, scans]) => ({ source, scans }))
        .sort((a, b) => b.scans - a.scans),
      fallbackToTable: totalTable,
      notMeasured: [
        "Rung accuracy against the rule table. No owner labels are stored, so there is nothing to score against.",
        "Reorder counts. How many findings a rung actually moved is not stored.",
        "Swap consistency. Both presentation orders are not run yet, so there is no rate to report.",
        "Which rung failed and why per call. Attempts are logged per call but not persisted here.",
      ],
    };
  },
});
