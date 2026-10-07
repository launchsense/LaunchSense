import { internalQuery } from "./_generated/server";
import { v } from "convex/values";

// Decision-source monitoring. One read over stored fields, no new tracker.
//
// What this answers, and what it deliberately does not: it reports how often each
// rung of the decision lane answered, how often the rule table answered instead,
// and how long the call took. It does not score any rung, does not compare
// a rung to the table's own order, and does not promote or retire a rung. Those
// need owner labels this table does not hold. A rung with zero rows here is
// unobserved, which is not the same as bad and not the same as good.
//
// The rows are usage diagnostics. They hold counts and a source name, never file
// text, so this query can be read without any disclosure rule.

// Hard ceiling on rows read in one call. The window and the day index already
// bound the read; this bounds the single worst case, a day index with a very
// large number of rows inside the window.
const MAX_ROWS = 5000;

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
      // Stored rows whose orderSource is "table". This is a row count, not a
      // fallback rate: it includes scans where no rung was configured or called at
      // all, so it cannot say a rung tried and lost. Named for what it counts.
      tableOrderRows: v.number(),
      // Rows where a rung other than the table answered.
      laneAnsweredRows: v.number(),
      // Rows where the lane moved at least one position, and the total positions moved.
      movedRows: v.number(),
      movedPositions: v.number(),
      medianDurationMs: v.number(),
      maxDurationMs: v.number(),
    })),
    // The whole window in one place, so a reader does not add up the days by hand.
    total: v.number(),
    totalsBySource: v.array(sourceCounts),
    // Rows where the table supplied the order. Not a rung failure count.
    tableOrderRows: v.number(),
    laneAnsweredRows: v.number(),
    movedRows: v.number(),
    movedPositions: v.number(),
    // Which rung produced the licence suggestion, across the window.
    totalsBySuggestionSource: v.array(sourceCounts),
    // Fields this table does not store, named so a reader does not go looking.
    notMeasured: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const days = Math.min(Math.max(args.days ?? 7, 1), 90);
    const since = Date.now() - days * 24 * 60 * 60 * 1000;
    // The index key is the stored day string, so the window becomes a range on
    // that string instead of a whole-table collect. Rows outside it are never read.
    const sinceDay = new Date(since).toISOString().slice(0, 10);

    const rows = await ctx.db
      .query("usageDiagnostics")
      .withIndex("by_day", (q) => q.gte("day", sinceDay))
      .order("desc")
      .take(MAX_ROWS);

    // The index range is day-granular, so a day on the boundary can hold rows
    // from just before the window. This keeps the exact cutoff.
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
      let laneAnswered = 0;
      let movedRows = 0;
      let movedPositions = 0;
      const durations: number[] = [];
      for (const row of bucket) {
        sources.set(row.orderSource, (sources.get(row.orderSource) ?? 0) + 1);
        if (row.orderSource === "table") table += 1;
        if (row.laneAnswered === true) laneAnswered += 1;
        if (row.orderMoved > 0) {
          movedRows += 1;
          movedPositions += row.orderMoved;
        }
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
        tableOrderRows: table,
        laneAnsweredRows: laneAnswered,
        movedRows,
        movedPositions,
        medianDurationMs: durations.length % 2 === 0
          ? (durations[middle - 1] ?? 0) / 2 + (durations[middle] ?? 0) / 2
          : durations[middle] ?? 0,
        maxDurationMs: durations[durations.length - 1] ?? 0,
      };
    });

    const totalSources = new Map<string, number>();
    const suggestionSources = new Map<string, number>();
    let totalTable = 0;
    let totalLaneAnswered = 0;
    let totalMovedRows = 0;
    let totalMovedPositions = 0;
    for (const row of inWindow) {
      totalSources.set(row.orderSource, (totalSources.get(row.orderSource) ?? 0) + 1);
      if (row.orderSource === "table") totalTable += 1;
      if (row.laneAnswered === true) totalLaneAnswered += 1;
      if (row.orderMoved > 0) {
        totalMovedRows += 1;
        totalMovedPositions += row.orderMoved;
      }
      suggestionSources.set(row.suggestionSource, (suggestionSources.get(row.suggestionSource) ?? 0) + 1);
    }

    return {
      days: dayBlocks,
      total: inWindow.length,
      totalsBySource: [...totalSources.entries()]
        .map(([source, scans]) => ({ source, scans }))
        .sort((a, b) => b.scans - a.scans),
      tableOrderRows: totalTable,
      laneAnsweredRows: totalLaneAnswered,
      movedRows: totalMovedRows,
      movedPositions: totalMovedPositions,
      totalsBySuggestionSource: [...suggestionSources.entries()]
        .map(([source, scans]) => ({ source, scans }))
        .sort((a, b) => b.scans - a.scans),
      notMeasured: [
        "Rung accuracy against the rule table. No owner labels are stored, so there is nothing to score against.",
        "Whether a move was an improvement. movedPositions says a rung reordered rows; it does not say the new order was better, because there is no owner label to compare against.",
        "Swap consistency. Both presentation orders are not run yet, so there is no rate to report.",
        "Which rung failed and why per call. Attempts are logged per call but not persisted here.",
        "Whether a table row means a rung lost. A stored table row can also be a scan where no rung ran, so tableOrderRows is a count of rows and not a failure count.",
        "Rows past the per-call cap. A single call reads at most 5000 rows in the window, newest first, and does not report how many it left out.",
      ],
    };
  },
});
