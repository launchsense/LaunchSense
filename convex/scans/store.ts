import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";

const severity = v.union(
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
  v.literal("info"),
);

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

const fullScanDoc = v.object({
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
});

const evidenceValidator = v.object({
  ruleId: v.string(),
  path: v.string(),
  line: v.number(),
  contentHash: v.string(),
  redactedSnippet: v.string(),
  severity,
});

const findingValidator = v.object({
  ruleId: v.string(),
  fingerprint: v.string(),
  path: v.string(),
  line: v.number(),
  severity,
  title: v.string(),
  why: v.string(),
  bucket: v.union(v.literal("actionable"), v.literal("info")),
});

export const fetchScan = internalQuery({
  args: { scanId: v.id("scans") },
  returns: v.union(fullScanDoc, v.null()),
  handler: async (ctx, args) => {
    return await ctx.db.get("scans", args.scanId);
  },
});

export const getCachedContent = internalQuery({
  args: {
    owner: v.string(),
    repo: v.string(),
    sha: v.string(),
    path: v.string(),
    sinceMs: v.number(),
  },
  returns: v.union(
    v.object({
      content: v.string(),
      size: v.number(),
      contentSha: v.string(),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("fileContents")
      .withIndex("by_repo_sha_path", (q) =>
        q.eq("owner", args.owner).eq("repo", args.repo).eq("sha", args.sha).eq("path", args.path),
      )
      .order("desc")
      .take(1);
    const hit = matches[0] ?? null;
    if (hit === null || hit.fetchedAt < args.sinceMs) return null;
    return { content: hit.content, size: hit.size, contentSha: hit.contentSha };
  },
});

export const saveContent = internalMutation({
  args: {
    owner: v.string(),
    repo: v.string(),
    sha: v.string(),
    path: v.string(),
    contentSha: v.string(),
    size: v.number(),
    truncated: v.boolean(),
    fetchedAt: v.number(),
    content: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("fileContents")
      .withIndex("by_repo_sha_path", (q) =>
        q.eq("owner", args.owner).eq("repo", args.repo).eq("sha", args.sha).eq("path", args.path),
      )
      .order("desc")
      .take(1);
    const doc = {
      owner: args.owner,
      repo: args.repo,
      sha: args.sha,
      path: args.path,
      contentSha: args.contentSha,
      size: args.size,
      truncated: args.truncated,
      fetchedAt: args.fetchedAt,
      content: args.content,
    };
    if (existing[0] !== undefined) {
      await ctx.db.patch("fileContents", existing[0]._id, doc);
    } else {
      await ctx.db.insert("fileContents", doc);
    }
    return null;
  },
});

export const getOsvEntry = internalQuery({
  args: { ecosystem: v.string(), name: v.string(), version: v.string(), sinceMs: v.number() },
  returns: v.union(
    v.object({
      timedOut: v.boolean(),
      vulns: v.array(v.object({ id: v.string(), summary: v.string(), severity: v.string() })),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("osvCache")
      .withIndex("by_package", (q) =>
        q.eq("ecosystem", args.ecosystem).eq("name", args.name).eq("version", args.version),
      )
      .order("desc")
      .take(1);
    const hit = matches[0] ?? null;
    if (hit === null || hit.checkedAt < args.sinceMs) return null;
    return { timedOut: hit.timedOut, vulns: hit.vulns };
  },
});

export const saveOsvEntry = internalMutation({
  args: {
    ecosystem: v.string(),
    name: v.string(),
    version: v.string(),
    checkedAt: v.number(),
    timedOut: v.boolean(),
    vulns: v.array(v.object({ id: v.string(), summary: v.string(), severity: v.string() })),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("osvCache")
      .withIndex("by_package", (q) =>
        q.eq("ecosystem", args.ecosystem).eq("name", args.name).eq("version", args.version),
      )
      .order("desc")
      .take(1);
    const doc = {
      ecosystem: args.ecosystem,
      name: args.name,
      version: args.version,
      checkedAt: args.checkedAt,
      timedOut: args.timedOut,
      vulns: args.vulns,
    };
    if (existing[0] !== undefined) {
      await ctx.db.patch("osvCache", existing[0]._id, doc);
    } else {
      await ctx.db.insert("osvCache", doc);
    }
    return null;
  },
});

export const clearResults = internalMutation({
  args: { scanId: v.id("scans") },
  returns: v.null(),
  handler: async (ctx, args) => {
    const evidence = await ctx.db
      .query("evidenceItems")
      .withIndex("by_scan", (q) => q.eq("scanId", args.scanId))
      .order("desc")
      .take(1000);
    for (const row of evidence) await ctx.db.delete("evidenceItems", row._id);
    const findings = await ctx.db
      .query("findings")
      .withIndex("by_scan", (q) => q.eq("scanId", args.scanId))
      .order("desc")
      .take(1000);
    for (const row of findings) await ctx.db.delete("findings", row._id);
    return null;
  },
});

export const saveResults = internalMutation({
  args: {
    scanId: v.id("scans"),
    analyzerVersion: v.string(),
    analyzedAt: v.number(),
    fetchedFileCount: v.number(),
    skippedFileCount: v.number(),
    coverageNote: v.string(),
    status: scanStatus,
    errorKind: v.optional(scanErrorKind),
    errorMessage: v.optional(v.string()),
    rateLimitResetAt: v.optional(v.number()),
    evidence: v.array(evidenceValidator),
    findings: v.array(findingValidator),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const now = args.analyzedAt;
    for (const item of args.evidence) {
      await ctx.db.insert("evidenceItems", {
        scanId: args.scanId,
        ruleId: item.ruleId,
        analyzerVersion: args.analyzerVersion,
        path: item.path,
        line: item.line,
        contentHash: item.contentHash,
        redactedSnippet: item.redactedSnippet,
        severity: item.severity,
        createdAt: now,
      });
    }
    const seen = new Set<string>();
    for (const item of args.findings) {
      if (seen.has(item.fingerprint)) continue;
      seen.add(item.fingerprint);
      await ctx.db.insert("findings", {
        scanId: args.scanId,
        ruleId: item.ruleId,
        analyzerVersion: args.analyzerVersion,
        fingerprint: item.fingerprint,
        path: item.path,
        line: item.line,
        severity: item.severity,
        title: item.title,
        why: item.why,
        bucket: item.bucket,
        createdAt: now,
      });
    }
    await ctx.db.patch("scans", args.scanId, {
      status: args.status,
      analyzerVersion: args.analyzerVersion,
      fetchedFileCount: args.fetchedFileCount,
      skippedFileCount: args.skippedFileCount,
      analyzedAt: args.analyzedAt,
      coverageNote: args.coverageNote,
      errorKind: args.errorKind,
      errorMessage: args.errorMessage,
      rateLimitResetAt: args.rateLimitResetAt,
      updatedAt: now,
    });
    return null;
  },
});

export const listFindings = internalQuery({
  args: { scanId: v.id("scans") },
  returns: v.array(
    v.object({
      ruleId: v.string(),
      fingerprint: v.string(),
      path: v.string(),
      line: v.number(),
      severity,
      title: v.string(),
      why: v.string(),
      bucket: v.union(v.literal("actionable"), v.literal("info")),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("findings")
      .withIndex("by_scan", (q) => q.eq("scanId", args.scanId))
      .order("desc")
      .take(500);
    return rows.map((r) => ({
      ruleId: r.ruleId,
      fingerprint: r.fingerprint,
      path: r.path,
      line: r.line,
      severity: r.severity,
      title: r.title,
      why: r.why,
      bucket: r.bucket,
    }));
  },
});
