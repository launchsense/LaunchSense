import { mutation, query } from "../_generated/server";
import type { QueryCtx } from "../_generated/server";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";

const scanStatus = v.union(
  v.literal("validating"),
  v.literal("fetching"),
  v.literal("completed"),
  v.literal("partial"),
  v.literal("failed"),
);

const scanErrorKind = v.union(
  v.literal("invalid_url"),
  v.literal("not_found"),
  v.literal("rate_limited"),
  v.literal("truncated"),
  v.literal("network"),
  v.literal("unknown"),
);

const severity = v.union(
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
  v.literal("info"),
);

const scanFields = {
  _id: v.id("scans"),
  _creationTime: v.number(),
  owner: v.string(),
  repo: v.string(),
  repoUrl: v.string(),
  status: scanStatus,
  sha: v.optional(v.string()),
  defaultBranch: v.optional(v.string()),
  fileCount: v.optional(v.number()),
  truncated: v.optional(v.boolean()),
  treeTruncated: v.optional(v.boolean()),
  errorKind: v.optional(scanErrorKind),
  errorMessage: v.optional(v.string()),
  rateLimitResetAt: v.optional(v.number()),
  analyzerVersion: v.optional(v.string()),
  fetchedFileCount: v.optional(v.number()),
  skippedFileCount: v.optional(v.number()),
  analyzedAt: v.optional(v.number()),
  coverageNote: v.optional(v.string()),
  liveUrl: v.optional(v.string()),
  mainAction: v.optional(v.string()),
  rescanOf: v.optional(v.id("scans")),
  createdAt: v.number(),
  updatedAt: v.number(),
};

export const analyticsKind = v.union(
  v.literal("scan_started"),
  v.literal("scan_completed"),
  v.literal("scan_partial"),
  v.literal("live_checked"),
  v.literal("share_created"),
  v.literal("passport_created"),
  v.literal("share_viewed"),
  v.literal("share_cta_clicked"),
  v.literal("referred_visit"),
  v.literal("referred_scan_started"),
);

const findingFields = {
  ruleId: v.string(),
  fingerprint: v.string(),
  path: v.string(),
  line: v.number(),
  severity,
  title: v.string(),
  why: v.string(),
  bucket: v.union(v.literal("actionable"), v.literal("info")),
};

export const getScan = query({
  args: { scanId: v.id("scans") },
  returns: v.object({
    scan: v.union(v.object(scanFields), v.null()),
    samplePaths: v.array(v.object({ path: v.string(), type: v.string() })),
    storedEntries: v.number(),
  }),
  handler: async (ctx, args) => {
    const scan = await ctx.db.get("scans", args.scanId);
    if (scan === null) {
      return { scan: null, samplePaths: [], storedEntries: 0 };
    }
    if (scan.sha === undefined) {
      return { scan, samplePaths: [], storedEntries: 0 };
    }
    const trees = await ctx.db
      .query("repoTrees")
      .withIndex("by_repo_sha", (q) =>
        q.eq("owner", scan.owner).eq("repo", scan.repo).eq("sha", scan.sha as string),
      )
      .order("desc")
      .take(1);
    const tree = trees[0] ?? null;
    if (tree === null) return { scan, samplePaths: [], storedEntries: 0 };
    return {
      scan,
      samplePaths: tree.entries.slice(0, 100),
      storedEntries: tree.entryCountStored,
    };
  },
});

export const getResults = query({
  args: { scanId: v.id("scans") },
  returns: v.object({
    scan: v.union(v.object(scanFields), v.null()),
    findings: v.array(v.object(findingFields)),
    analyzed: v.boolean(),
    live: v.union(
      v.object({
        url: v.string(),
        finalUrl: v.optional(v.string()),
        https: v.boolean(),
        reaches: v.boolean(),
        httpStatus: v.optional(v.number()),
        nonBlank: v.optional(v.boolean()),
        mainActionFound: v.optional(v.boolean()),
        viewportMeta: v.optional(v.boolean()),
        hops: v.number(),
        errorMessage: v.optional(v.string()),
        checkedAt: v.number(),
      }),
      v.null(),
    ),
  }),
  handler: async (ctx, args) => {
    const scan = await ctx.db.get("scans", args.scanId);
    if (scan === null) return { scan: null, findings: [], analyzed: false, live: null };
    if (scan.analyzedAt === undefined) {
      return { scan, findings: [], analyzed: false, live: null };
    }
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_scan", (q) => q.eq("scanId", args.scanId))
      .order("desc")
      .take(500);
    const liveRows = await ctx.db
      .query("liveChecks")
      .withIndex("by_scan", (q) => q.eq("scanId", args.scanId))
      .order("desc")
      .take(1);
    const liveRow = liveRows[0] ?? null;
    return {
      scan,
      findings: rows.map((r) => ({
        ruleId: r.ruleId,
        fingerprint: r.fingerprint,
        path: r.path,
        line: r.line,
        severity: r.severity,
        title: r.title,
        why: r.why,
        bucket: r.bucket,
      })),
      analyzed: true,
      live:
        liveRow === null
          ? null
          : {
              url: liveRow.url,
              finalUrl: liveRow.finalUrl,
              https: liveRow.https,
              reaches: liveRow.reaches,
              httpStatus: liveRow.httpStatus,
              nonBlank: liveRow.nonBlank,
              mainActionFound: liveRow.mainActionFound,
              viewportMeta: liveRow.viewportMeta,
              hops: liveRow.hops,
              errorMessage: liveRow.errorMessage,
              checkedAt: liveRow.checkedAt,
            },
    };
  },
});

const publicFinding = v.object({
  ruleId: v.string(),
  severity,
  title: v.string(),
  why: v.string(),
});

interface PublicScan {
  owner: string;
  repo: string;
  sha: string | undefined;
  status: "validating" | "fetching" | "completed" | "partial" | "failed";
  analyzedAt: number | undefined;
  coverageNote: string | undefined;
}

interface PublicFindingRow {
  ruleId: string;
  severity: "high" | "medium" | "low" | "info";
  title: string;
  why: string;
}

interface PublicBundle {
  scan: PublicScan | null;
  findings: PublicFindingRow[];
}

async function publicScanBundle(
  ctx: QueryCtx,
  scanId: Id<"scans">,
): Promise<PublicBundle | null> {
  const scan = await ctx.db.get("scans", scanId);
  if (scan === null || scan.analyzedAt === undefined) return null;
  const rows = await ctx.db
    .query("findings")
    .withIndex("by_scan", (q) => q.eq("scanId", scan._id))
    .order("desc")
    .take(500);
  return {
    scan: {
      owner: scan.owner,
      repo: scan.repo,
      sha: scan.sha,
      status: scan.status,
      analyzedAt: scan.analyzedAt,
      coverageNote: scan.coverageNote,
    },
    findings: rows.map((r) => ({
      ruleId: r.ruleId,
      severity: r.severity,
      title: r.title,
      why: r.why,
    })),
  };
}

export const getSharePage = query({
  args: { shareId: v.string() },
  returns: v.union(
    v.object({
      scan: v.object({
        owner: v.string(),
        repo: v.string(),
        sha: v.optional(v.string()),
        status: scanStatus,
        analyzedAt: v.optional(v.number()),
        coverageNote: v.optional(v.string()),
      }),
      findings: v.array(publicFinding),
      createdAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("shareArtifacts")
      .withIndex("by_shareId", (q) => q.eq("shareId", args.shareId))
      .order("desc")
      .take(1);
    if (matches[0] === undefined) return null;
    const bundle = await publicScanBundle(ctx, matches[0].scanId);
    if (bundle === null) return null;
    if (bundle.scan === null) return null;
    return {
      scan: bundle.scan,
      findings: bundle.findings,
      createdAt: matches[0].createdAt,
    };
  },
});

export const getPassportPage = query({
  args: { passportId: v.string() },
  returns: v.union(
    v.object({
      scan: v.object({
        owner: v.string(),
        repo: v.string(),
        sha: v.optional(v.string()),
        status: scanStatus,
        analyzedAt: v.optional(v.number()),
        coverageNote: v.optional(v.string()),
      }),
      findings: v.array(publicFinding),
      createdAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("passportArtifacts")
      .withIndex("by_passportId", (q) => q.eq("passportId", args.passportId))
      .order("desc")
      .take(1);
    if (matches[0] === undefined) return null;
    const bundle = await publicScanBundle(ctx, matches[0].scanId);
    if (bundle === null) return null;
    if (bundle.scan === null) return null;
    return {
      scan: bundle.scan,
      findings: bundle.findings,
      createdAt: matches[0].createdAt,
    };
  },
});

export const logEvent = mutation({
  args: {
    kind: analyticsKind,
    scanId: v.optional(v.id("scans")),
    shareId: v.optional(v.string()),
    refShareId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = Date.now();
    await ctx.db.insert("analyticsEvents", {
      day: new Date(now).toISOString().slice(0, 10),
      kind: args.kind,
      scanId: args.scanId,
      shareId: args.shareId?.slice(0, 64),
      refShareId: args.refShareId?.slice(0, 64),
      createdAt: now,
    });
    return null;
  },
});

const transitionDetail = v.object({
  oldFingerprint: v.optional(v.string()),
  newFingerprint: v.optional(v.string()),
  ruleId: v.string(),
  state: v.union(
    v.literal("fixed"),
    v.literal("still_broken"),
    v.literal("new"),
    v.literal("regressed"),
    v.literal("unknown"),
  ),
  cause: v.optional(
    v.union(
      v.literal("code_change"),
      v.literal("advisory_update"),
      v.literal("analyzer_update"),
    ),
  ),
  title: v.string(),
  path: v.string(),
  line: v.number(),
  severity,
});

export const getCompare = query({
  args: { fromScanId: v.id("scans"), toScanId: v.id("scans") },
  returns: v.union(
    v.object({
      from: v.object({
        sha: v.optional(v.string()),
        status: scanStatus,
        analyzedAt: v.optional(v.number()),
      }),
      to: v.object({
        sha: v.optional(v.string()),
        status: scanStatus,
        analyzedAt: v.optional(v.number()),
      }),
      sameSha: v.boolean(),
      transitions: v.array(transitionDetail),
      accepted: v.array(v.string()),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const from = await ctx.db.get("scans", args.fromScanId);
    const to = await ctx.db.get("scans", args.toScanId);
    if (from === null || to === null) return null;
    if (from.analyzedAt === undefined || to.analyzedAt === undefined) return null;
    const rows = await ctx.db
      .query("findingTransitions")
      .withIndex("by_pair", (q) => q.eq("fromScanId", args.fromScanId).eq("toScanId", args.toScanId))
      .order("desc")
      .take(1000);
    if (rows.length === 0) return null;
    const oldRows = await ctx.db
      .query("findings")
      .withIndex("by_scan", (q) => q.eq("scanId", args.fromScanId))
      .order("desc")
      .take(500);
    const newRows = await ctx.db
      .query("findings")
      .withIndex("by_scan", (q) => q.eq("scanId", args.toScanId))
      .order("desc")
      .take(500);
    const oldByFp = new Map(oldRows.map((r) => [r.fingerprint, r]));
    const newByFp = new Map(newRows.map((r) => [r.fingerprint, r]));
    const decisions = await ctx.db
      .query("userDecisions")
      .withIndex("by_scan", (q) => q.eq("scanId", args.toScanId))
      .order("desc")
      .take(200);
    return {
      from: { sha: from.sha, status: from.status, analyzedAt: from.analyzedAt },
      to: { sha: to.sha, status: to.status, analyzedAt: to.analyzedAt },
      sameSha: from.sha !== undefined && from.sha === to.sha,
      transitions: rows.map((t) => {
        const detail =
          (t.newFingerprint !== undefined ? newByFp.get(t.newFingerprint) : undefined) ??
          (t.oldFingerprint !== undefined ? oldByFp.get(t.oldFingerprint) : undefined);
        return {
          oldFingerprint: t.oldFingerprint,
          newFingerprint: t.newFingerprint,
          ruleId: t.ruleId,
          state: t.state,
          cause: t.cause,
          title: detail?.title ?? t.ruleId,
          path: detail?.path ?? "(repo)",
          line: detail?.line ?? 0,
          severity: detail?.severity ?? "info",
        };
      }),
      accepted: decisions.map((d) => d.fingerprint),
    };
  },
});

export const setDecision = mutation({
  args: { scanId: v.id("scans"), fingerprint: v.string() },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.fingerprint.length === 0 || args.fingerprint.length > 200) {
      throw new Error("That finding reference is not valid.");
    }
    await ctx.db.insert("userDecisions", {
      scanId: args.scanId,
      fingerprint: args.fingerprint,
      decision: "accepted_risk",
      createdAt: Date.now(),
    });
    return null;
  },
});
