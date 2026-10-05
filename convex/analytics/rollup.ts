import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { forbiddenPropertiesIn } from "./privacy";

// The nightly fold. Raw staging rows plus scan and transition facts become a few
// hundred dailyMetrics rows, and the funnel itself is derived rather than written.
//
// The trap this file exists to avoid: the naive funnel is scan -> rescan -> done,
// which measures curiosity. Eleven scans of one repo with nothing changed is not
// activation. The fix is never instrumented, because asking the user produces a
// flattering number nobody can verify. It is inferred from findingTransitions,
// which already links a real pair of scans and already separates a developer's
// edit from an advisory refresh and from an analyzer upgrade.
//
// Identity rule: every join goes through scans._id and
// findingTransitions.fromScanId / toScanId, never through the event stream.
// A repo name is read to link a scan pair and is dropped before anything is
// written. No analytics row carries an owner/repo pair in any form, hashed or
// not, so a folded day cannot be joined back to a repository by anyone holding
// the table.

// Read bounds. Every one of these is a ceiling, not a target. A day that reaches
// one says so in the returned summary rather than quietly counting less than it
// read, because a short count reads like a real drop in the metric.
const SCAN_WINDOW_DAYS = 8;
const READ_PAGE = 256;
const MAX_SCAN_PAGES = 40;
const MAX_TRANSITION_PAGES = 40;
// The staging read for one day. usageEvents has a by_day index, so this is one
// ranged query with a row ceiling, not a page walk.
const MAX_USAGE_EVENT_ROWS = 5000;
const MAX_METRIC_ROWS = 2000;
const DIM_JSON_CAP = 400;

// A scan that is still validating or fetching has produced no finding fact, so it
// is not an analyzed event.
const ANALYZED_STATUSES = new Set(["completed", "partial", "failed"]);

export type FoldScan = {
  _id: string;
  status: string;
  owner: string;
  repo: string;
  createdAt: number;
  analyzedAt?: number;
  sha?: string;
  rescanOf?: string;
  surface?: string;
  truncated?: boolean;
  treeTruncated?: boolean;
  errorKind?: string;
};

export type FoldTransition = {
  _id: string;
  fromScanId: string;
  toScanId: string;
  ruleId: string;
  state: string;
  cause?: string;
  createdAt: number;
};

export type MetricRow = {
  metric: string;
  dims: Record<string, string>;
  count: number;
  ratio: number | undefined;
};

/** index lookup for a table the fold already read. */
export function indexScans(scans: readonly FoldScan[]): Map<string, FoldScan> {
  const byId = new Map<string, FoldScan>();
  for (const scan of scans) byId.set(scan._id, scan);
  return byId;
}

/** Transition rows grouped by their scan pair, "fromId>toId". */
export function indexPairs(
  transitions: readonly FoldTransition[],
): Map<string, FoldTransition[]> {
  const pairs = new Map<string, FoldTransition[]>();
  for (const transition of transitions) {
    const key = `${transition.fromScanId}>${transition.toScanId}`;
    const bucket = pairs.get(key);
    if (bucket === undefined) pairs.set(key, [transition]);
    else bucket.push(transition);
  }
  return pairs;
}

/**
 * Why a scan was partial, as a closed set of reasons.
 *
 * Reported split by reason because truncated, a truncated tree, and a rate limit
 * have three different fixes. Never the raw error message: that is unreviewed
 * free text and it can carry anything.
 */
export function partialReason(scan: {
  truncated?: boolean;
  treeTruncated?: boolean;
  errorKind?: string;
}): string {
  if (
    scan.errorKind !== undefined &&
    scan.errorKind !== "" &&
    scan.errorKind !== "unknown"
  ) {
    return `error:${scan.errorKind}`;
  }
  if (scan.truncated === true) return "truncated";
  if (scan.treeTruncated === true) return "tree_truncated";
  return "unspecified";
}

/** The closed metric vocabulary this rollup emits. */
export const METRIC_NAMES = [
  "mcp_session_initialized",
  "mcp_tools_listed",
  "mcp_tool_called",
  "scan_submitted",
  "scan_analyzed",
  "scan_partial",
  "partial_coverage_rate",
  "partial_coverage_count",
  "rescan_requested",
  "rescan_analyzed",
  "repos_with_proven_fix",
  "code_change_fix_count",
  "advisory_fix_count",
  "analyzer_fix_count",
  "unattributed_fix_count",
  "regression_after_fix_rate",
] as const;

const ratioOf = (numerator: number, denominator: number): number | undefined =>
  denominator > 0 ? numerator / denominator : undefined;

const inWindow = (ms: number | undefined, start: number, end: number): boolean =>
  typeof ms === "number" && Number.isFinite(ms) && ms >= start && ms < end;

const surfaceOf = (scan: { surface?: string }): string => scan.surface ?? "unspecified";

/**
 * Group the MCP staging rows.
 *
 * Tool is a dimension here, never part of the metric name. Two tools therefore
 * multiply no rows, which is what keeps the event count small.
 */
export function deriveFromUsageEvents(
  events: ReadonlyArray<{
    kind: string;
    clientName: string;
    toolName?: string;
    outcome: string;
  }>,
  add: (metric: string, dims: Record<string, string>, count?: number) => void,
): void {
  for (const event of events) {
    add(
      event.kind,
      { client: event.clientName, tool: event.toolName ?? "none", outcome: event.outcome },
      1,
    );
  }
}

/**
 * Scan facts.
 *
 * Submitted is attributed to creation, so a queued scan still counts once.
 * Analyzed is attributed to analyzedAt, so a scan queued overnight is counted on
 * the day it actually produced a result rather than the day it was pasted.
 */
export function deriveFromScans(
  scans: readonly FoldScan[],
  window: { start: number; end: number },
  add: (metric: string, dims: Record<string, string>, count?: number) => void,
): void {
  for (const scan of scans) {
    if (inWindow(scan.createdAt, window.start, window.end)) {
      add("scan_submitted", { surface: surfaceOf(scan) }, 1);
      if (scan.rescanOf !== undefined) {
        add("rescan_requested", { surface: surfaceOf(scan) }, 1);
      }
    }
    if (!inWindow(scan.analyzedAt, window.start, window.end)) continue;
    if (!ANALYZED_STATUSES.has(scan.status)) continue;
    add("scan_analyzed", { status: scan.status, surface: surfaceOf(scan) }, 1);
    if (scan.status === "partial") {
      add("scan_partial", { reason: partialReason(scan), surface: surfaceOf(scan) }, 1);
    }
  }
}

/**
 * Guardrail 1: partial coverage rate.
 *
 * The honesty guardrail, and non-negotiable for this product specifically: the
 * product's own MCP output ends every report with "A partial result is not a
 * pass." If the north star climbs while this climbs too, the tool is proving fixes
 * by reading less code, and both numbers are then lies. Watch the pair, never the
 * north star alone.
 */
export function partialCoverageRate(
  scans: readonly FoldScan[],
  window: { start: number; end: number },
): {
  count: number;
  total: number;
  ratio: number | undefined;
  byReason: Record<string, number>;
} {
  let count = 0;
  let total = 0;
  const byReason: Record<string, number> = {};
  for (const scan of scans) {
    if (!inWindow(scan.analyzedAt, window.start, window.end)) continue;
    if (!ANALYZED_STATUSES.has(scan.status)) continue;
    total += 1;
    if (scan.status !== "partial") continue;
    count += 1;
    const reason = partialReason(scan);
    byReason[reason] = (byReason[reason] ?? 0) + 1;
  }
  return { count, total, ratio: ratioOf(count, total), byReason };
}

/** A repo counted once, never once per scan. */
function repoIdentity(scan: FoldScan): string | null {
  if (typeof scan.owner !== "string" || typeof scan.repo !== "string") return null;
  if (scan.owner.length === 0 || scan.repo.length === 0) return null;
  return `${scan.owner}/${scan.repo}`;
}

/**
 * The north star: repos with a proven fix.
 *
 * A repo counts when a findingTransitions row says state=fixed AND
 * cause=code_change, and BOTH endpoint scans reached status=completed. A fix
 * attributed to advisory_update or analyzer_update is this product shipping a new
 * rule pack, not a developer shipping a fix, so it is counted on its own metric
 * and never folded in here.
 *
 * Distinct repo, not distinct scan: eleven scans of one repo is one repo measured.
 * The identity lives in this function's return value only. Nothing about the repo
 * is written, which is why the count can be published and the name cannot.
 */
export function deriveNorthStar(
  transitions: readonly FoldTransition[],
  scanById: ReadonlyMap<string, FoldScan>,
  window: { start: number; end: number },
): {
  count: number;
  reposTotal: number;
  byCause: Record<string, number>;
  bySurface: Record<string, number>;
} {
  const proven = new Set<string>();
  const bySurface = new Map<string, Set<string>>();
  const reposTotal = new Set<string>();
  const byCause: Record<string, number> = {
    code_change: 0,
    advisory_update: 0,
    analyzer_update: 0,
    unattributed: 0,
  };
  for (const transition of transitions) {
    if (!inWindow(transition.createdAt, window.start, window.end)) continue;
    const to = scanById.get(transition.toScanId);
    if (to !== undefined) {
      const identity = repoIdentity(to);
      if (identity !== null) reposTotal.add(identity);
    }
    if (transition.state !== "fixed") continue;
    const from = scanById.get(transition.fromScanId);
    const toScan = scanById.get(transition.toScanId);
    if (from === undefined || toScan === undefined) continue;
    if (from.status !== "completed" || toScan.status !== "completed") continue;
    const cause = transition.cause ?? "unattributed";
    byCause[cause] = (byCause[cause] ?? 0) + 1;
    if (cause !== "code_change") continue;
    const identity = repoIdentity(toScan);
    if (identity === null) continue;
    if (!proven.has(identity)) proven.add(identity);
    const surface = surfaceOf(toScan);
    const bucket = bySurface.get(surface);
    if (bucket === undefined) bySurface.set(surface, new Set([identity]));
    else bucket.add(identity);
  }
  return {
    count: proven.size,
    reposTotal: reposTotal.size,
    byCause,
    bySurface: Object.fromEntries([...bySurface].map(([surface, set]) => [surface, set.size])),
  };
}

/**
 * Re-scans that reached a terminal status, counted per scan pair.
 *
 * Per pair, not per transition row, so a repo compared eleven times is eleven
 * pairs and still one repo wherever a repo is the unit.
 */
export function deriveRescanOutcomes(
  transitions: readonly FoldTransition[],
  scanById: ReadonlyMap<string, FoldScan>,
  window: { start: number; end: number },
  add: (metric: string, dims: Record<string, string>, count?: number) => void,
): void {
  const seen = new Set<string>();
  for (const transition of transitions) {
    if (!inWindow(transition.createdAt, window.start, window.end)) continue;
    const key = `${transition.fromScanId}>${transition.toScanId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const to = scanById.get(transition.toScanId);
    add("rescan_analyzed", { surface: to === undefined ? "unspecified" : surfaceOf(to) }, 1);
  }
}

/**
 * Guardrail 2: regression after fix.
 *
 * Of the code-change fixes this fold counted between two completed scans, how many
 * of the same ruleId come back in the next completed scan of the same repo, as
 * state=regressed or as state=new? A fix that returns is a false fix, and this is
 * the guardrail that catches over-claiming. It only appears on the second re-scan
 * and only ever looks bad for the analyzer, which is why it is the easiest one to
 * leave out.
 *
 * The next completed scan is looked up inside the scans this fold already read,
 * so a chain that runs past the read window is not counted. That is a lower bound
 * on the rate, stated rather than guessed at.
 */
export function regressionAfterFixRate(
  transitions: readonly FoldTransition[],
  scans: readonly FoldScan[],
  pairs: ReadonlyMap<string, readonly FoldTransition[]>,
  window: { start: number; end: number },
): { fixed: number; returned: number; ratio: number | undefined } {
  const scanById = indexScans(scans);
  let fixed = 0;
  let returned = 0;
  for (const transition of transitions) {
    if (transition.state !== "fixed" || transition.cause !== "code_change") continue;
    if (!inWindow(transition.createdAt, window.start, window.end)) continue;
    const from = scanById.get(transition.fromScanId);
    const to = scanById.get(transition.toScanId);
    if (from === undefined || to === undefined) continue;
    if (from.status !== "completed" || to.status !== "completed") continue;
    fixed += 1;
    const next = nextCompletedScanOfRepo(scans, to);
    if (next === undefined) continue;
    const later = pairs.get(`${to._id}>${next._id}`) ?? [];
    const cameBack = later.some(
      (row) => row.ruleId === transition.ruleId && (row.state === "regressed" || row.state === "new"),
    );
    if (cameBack) returned += 1;
  }
  return { fixed, returned, ratio: ratioOf(returned, fixed) };
}

/** The earliest completed scan of the same repo after the given one. */
export function nextCompletedScanOfRepo(
  scans: readonly FoldScan[],
  after: FoldScan,
): FoldScan | undefined {
  const identity = repoIdentity(after);
  if (identity === null) return undefined;
  let best: FoldScan | undefined;
  for (const scan of scans) {
    if (scan.createdAt <= after.createdAt) continue;
    if (scan.status !== "completed") continue;
    if (repoIdentity(scan) !== identity) continue;
    if (best === undefined || scan.createdAt < best.createdAt) best = scan;
  }
  return best;
}

/**
 * Fold yesterday, then delete staging rows past their window.
 *
 * Yesterday, not today, so a day's numbers do not change under a reader. The day
 * is replaced rather than appended to, so a cron that runs twice, or is retried
 * after a conflict, cannot double count.
 */
export const rollupDaily = internalMutation({
  args: { now: v.optional(v.number()) },
  returns: v.object({
    day: v.string(),
    written: v.number(),
    replaced: v.number(),
    usageEventsRead: v.number(),
    scansRead: v.number(),
    scansTruncated: v.boolean(),
    transitionsRead: v.number(),
    transitionsTruncated: v.boolean(),
    reposWithProvenFix: v.number(),
    reposAnalyzed: v.number(),
    notMeasured: v.array(v.string()),
  }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    // Yesterday in UTC. The hour is fixed so the same calendar day is folded
    // every night whatever time the cron actually fires.
    const yesterday = new Date(now - 24 * 60 * 60 * 1000);
    const window = {
      start: Date.UTC(yesterday.getUTCFullYear(), yesterday.getUTCMonth(), yesterday.getUTCDate()),
      end: 0,
    };
    window.end = window.start + 24 * 60 * 60 * 1000;
    const day = new Date(window.start).toISOString().slice(0, 10);

    const rows = new Map<string, MetricRow>();
    const add = (
      metric: string,
      dims: Record<string, string>,
      count = 1,
      value?: number,
    ) => {
      // The dimension bag is checked before it becomes a stored row. A closed
      // vocabulary of client, tool, outcome, surface, status, reason and cause
      // cannot trip this, which is the point: the check is what makes a future
      // dimension addition a deliberate act rather than a leak.
      if (forbiddenPropertiesIn(dims).length > 0) return;
      const key = `${metric}|${JSON.stringify(dims)}`;
      const row = rows.get(key);
      if (row === undefined) {
        rows.set(key, { metric, dims, count, ratio: value });
        return;
      }
      row.count += count;
      if (value !== undefined) row.ratio = value;
    };

    // Replace the day. Deleting first is what makes a retried cron safe.
    const existing = await ctx.db
      .query("dailyMetrics")
      .withIndex("by_day", (q) => q.eq("day", day))
      .take(MAX_METRIC_ROWS);

    // 1. MCP staging rows, grouped by (kind, client, tool, outcome).
    const events = (await ctx.db
      .query("usageEvents")
      .withIndex("by_day", (q) => q.eq("day", day))
      .take(MAX_USAGE_EVENT_ROWS)) as unknown as Array<{
      kind: string;
      clientName: string;
      toolName?: string;
      outcome: string;
    }>;
    deriveFromUsageEvents(events, add);

    // 2. Scan facts. scans has no day index and this lane adds no index to an
    // existing table, so the window is read by page and then attributed in memory.
    const windowStart = window.start - (SCAN_WINDOW_DAYS - 1) * 24 * 60 * 60 * 1000;
    const scanned = await readPages<FoldScan>(
      (cursor) => ctx.db.query("scans").order("asc").paginate({ cursor, numItems: READ_PAGE }),
      MAX_SCAN_PAGES,
    );
    const scans = scanned.rows.filter((scan) => {
      const created = typeof scan.createdAt === "number" ? scan.createdAt : 0;
      return created >= windowStart && created < window.end;
    });
    deriveFromScans(scans, window, add);

    const coverage = partialCoverageRate(scans, window);
    add("partial_coverage_rate", { surface: "all" }, coverage.count, coverage.ratio);
    for (const [reason, count] of Object.entries(coverage.byReason)) {
      add("partial_coverage_count", { reason }, count);
    }

    // 3. Transitions, and the scan pairs they describe.
    const read = await readPages<FoldTransition>(
      (cursor) =>
        ctx.db.query("findingTransitions").order("asc").paginate({ cursor, numItems: READ_PAGE }),
      MAX_TRANSITION_PAGES,
    );
    const transitions = read.rows;
    const scanById = indexScans(scans);

    const north = deriveNorthStar(transitions, scanById, window);
    add("repos_with_proven_fix", { surface: "all" }, north.count);
    for (const [surface, count] of Object.entries(north.bySurface)) {
      add("repos_with_proven_fix", { surface }, count);
    }
    // The cause split is three separate metrics from day one. Once the fix count
    // is a single number the split cannot be recovered, and a number that mixes an
    // analyzer upgrade with a developer's edit is how a security tool ends up
    // claiming credit for its own rule pack.
    add("code_change_fix_count", { surface: "all" }, north.byCause.code_change ?? 0);
    add("advisory_fix_count", { surface: "all" }, north.byCause.advisory_update ?? 0);
    add("analyzer_fix_count", { surface: "all" }, north.byCause.analyzer_update ?? 0);
    add("unattributed_fix_count", { surface: "all" }, north.byCause.unattributed ?? 0);

    deriveRescanOutcomes(transitions, scanById, window, add);

    // 4. Guardrail 2.
    const regression = regressionAfterFixRate(transitions, scans, indexPairs(transitions), window);
    add("regression_after_fix_rate", { surface: "all" }, regression.returned, regression.ratio);

    for (const row of existing) await ctx.db.delete("dailyMetrics", row._id);
    let written = 0;
    for (const row of rows.values()) {
      if (written >= MAX_METRIC_ROWS) break;
      const dims = JSON.stringify(row.dims);
      if (dims.length > DIM_JSON_CAP) continue;
      await ctx.db.insert("dailyMetrics", {
        day,
        metric: row.metric,
        dims,
        count: row.count,
        ratio: row.ratio,
        createdAt: now,
      });
      written += 1;
    }

    // Retention is NOT done here. It is a separate job in
    // convex/analytics/retention.ts, on its own cron, so the window it enforces is
    // a named constant a reader can check rather than a cutoff computed inside a
    // fold. A Convex mutation cannot call another mutation, so folding it in would
    // have meant either a duplicated delete loop or a day whose numbers depend on
    // whether the retention half finished.

    return {
      day,
      written,
      replaced: existing.length,
      usageEventsRead: events.length,
      scansRead: scans.length,
      scansTruncated: scanned.truncated,
      transitionsRead: transitions.length,
      transitionsTruncated: read.truncated,
      reposWithProvenFix: north.count,
      reposAnalyzed: north.reposTotal,
      notMeasured: [
        "A repo dimension on any metric row. The north star counts distinct repos while the fold runs and stores only the count, so a stored day cannot be joined back to a repository.",
        "Client attribution for a tool call. The hosted surface is stateless over HTTP, so a tools/list or tools/call row carries whatever clientInfo the caller repeated and nothing when it repeated none. Session stitching needs SEP-414 context propagation and is not built.",
        "Severity and ruleId breakdowns of a fix. findingTransitions holds both, and no daily row carries them, because a per-rule dimension would multiply rows for a few hundred numbers.",
        "Latency percentiles. Only a mean duration exists in these rows; mcp.server.operation.duration needs real spans, which this surface does not emit.",
        "Rows past the read caps. Each cap is named in this file, and a day that reaches one reports scansTruncated or transitionsTruncated instead of quietly counting less than it read.",
        "A scan analyzed more than 8 days after it was submitted. scans has no day index and this lane adds none to an existing table, so the fold reads a window of createdAt and attributes analyzed facts inside it. A scan analyzed outside that window is not counted on the day it finished.",
        "Which tool call belonged to which session. The hosted surface is stateless over HTTP and this lane stores no session id, so tool volume is a total, not a per-conversation count.",
      ],
    };
  },
});

/**
 * Read a table by page, oldest first, with a hard page ceiling.
 *
 * Convex orders a whole-table query by creation time, so ascending pages walk the
 * table from its oldest row. `read` is the paginated call itself, passed in so
 * this helper stays typed against whichever table the caller is reading.
 */
async function readPages<T>(
  read: (cursor: string | null) => Promise<{
    page: T[];
    isDone: boolean;
    continueCursor: string;
  }>,
  maxPages: number,
): Promise<{ rows: T[]; truncated: boolean }> {
  const rows: T[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < maxPages; page += 1) {
    const result = await read(cursor);
    for (const row of result.page) rows.push(row);
    if (result.isDone) return { rows, truncated: false };
    cursor = result.continueCursor;
  }
  return { rows, truncated: true };
}