import { query } from "../_generated/server";
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
  createdAt: v.number(),
  updatedAt: v.number(),
};

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
  }),
  handler: async (ctx, args) => {
    const scan = await ctx.db.get("scans", args.scanId);
    if (scan === null) return { scan: null, findings: [], analyzed: false };
    if (scan.analyzedAt === undefined) {
      return { scan, findings: [], analyzed: false };
    }
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_scan", (q) => q.eq("scanId", args.scanId))
      .order("desc")
      .take(500);
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
    };
  },
});
