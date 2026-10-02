import { internalMutation, internalQuery } from "../_generated/server";
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

const scanDoc = v.object({
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
  createdAt: v.number(),
  updatedAt: v.number(),
});

const treeDoc = v.object({
  _id: v.id("repoTrees"),
  _creationTime: v.number(),
  owner: v.string(),
  repo: v.string(),
  sha: v.string(),
  fetchedAt: v.number(),
  fileCount: v.number(),
  truncated: v.boolean(),
  treeTruncated: v.boolean(),
  entryCountStored: v.number(),
  entries: v.array(v.object({ path: v.string(), type: v.string() })),
  etag: v.optional(v.string()),
});

export const findInFlight = internalQuery({
  args: { owner: v.string(), repo: v.string(), sinceMs: v.number() },
  returns: v.union(scanDoc, v.null()),
  handler: async (ctx, args) => {
    const recent = await ctx.db
      .query("scans")
      .withIndex("by_repo", (q) => q.eq("owner", args.owner).eq("repo", args.repo))
      .order("desc")
      .take(20);
    for (const scan of recent) {
      if (scan.updatedAt >= args.sinceMs && (scan.status === "validating" || scan.status === "fetching")) {
        return scan;
      }
    }
    return null;
  },
});

export const findCachedScan = internalQuery({
  args: { owner: v.string(), repo: v.string(), sha: v.string(), sinceMs: v.number() },
  returns: v.union(scanDoc, v.null()),
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("scans")
      .withIndex("by_repo_sha", (q) =>
        q.eq("owner", args.owner).eq("repo", args.repo).eq("sha", args.sha),
      )
      .order("desc")
      .take(5);
    for (const scan of matches) {
      if (scan.updatedAt >= args.sinceMs && (scan.status === "completed" || scan.status === "partial")) {
        return scan;
      }
    }
    return null;
  },
});

export const getTreeEntries = internalQuery({
  args: { owner: v.string(), repo: v.string(), sha: v.string() },
  returns: v.union(treeDoc, v.null()),
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("repoTrees")
      .withIndex("by_repo_sha", (q) =>
        q.eq("owner", args.owner).eq("repo", args.repo).eq("sha", args.sha),
      )
      .order("desc")
      .take(1);
    return matches[0] ?? null;
  },
});

export const createScan = internalMutation({
  args: {
    owner: v.string(),
    repo: v.string(),
    repoUrl: v.string(),
    now: v.number(),
  },
  returns: v.id("scans"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("scans", {
      owner: args.owner,
      repo: args.repo,
      repoUrl: args.repoUrl,
      status: "validating",
      createdAt: args.now,
      updatedAt: args.now,
    });
  },
});

export const markFetching = internalMutation({
  args: { scanId: v.id("scans"), now: v.number(), defaultBranch: v.optional(v.string()) },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("scans", args.scanId, {
      status: "fetching",
      defaultBranch: args.defaultBranch,
      updatedAt: args.now,
    });
    return null;
  },
});

export const markCompleted = internalMutation({
  args: {
    scanId: v.id("scans"),
    sha: v.string(),
    defaultBranch: v.string(),
    fileCount: v.number(),
    truncated: v.boolean(),
    treeTruncated: v.boolean(),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("scans", args.scanId, {
      status: "completed",
      sha: args.sha,
      defaultBranch: args.defaultBranch,
      fileCount: args.fileCount,
      truncated: args.truncated,
      treeTruncated: args.treeTruncated,
      errorKind: undefined,
      errorMessage: undefined,
      rateLimitResetAt: undefined,
      updatedAt: args.now,
    });
    return null;
  },
});

export const markPartial = internalMutation({
  args: {
    scanId: v.id("scans"),
    sha: v.optional(v.string()),
    defaultBranch: v.optional(v.string()),
    fileCount: v.optional(v.number()),
    truncated: v.optional(v.boolean()),
    treeTruncated: v.optional(v.boolean()),
    errorKind: scanErrorKind,
    errorMessage: v.string(),
    rateLimitResetAt: v.optional(v.number()),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("scans", args.scanId, {
      status: "partial",
      sha: args.sha,
      defaultBranch: args.defaultBranch,
      fileCount: args.fileCount,
      truncated: args.truncated,
      treeTruncated: args.treeTruncated,
      errorKind: args.errorKind,
      errorMessage: args.errorMessage,
      rateLimitResetAt: args.rateLimitResetAt,
      updatedAt: args.now,
    });
    return null;
  },
});

export const markFailed = internalMutation({
  args: {
    scanId: v.id("scans"),
    errorKind: scanErrorKind,
    errorMessage: v.string(),
    rateLimitResetAt: v.optional(v.number()),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("scans", args.scanId, {
      status: "failed",
      errorKind: args.errorKind,
      errorMessage: args.errorMessage,
      rateLimitResetAt: args.rateLimitResetAt,
      updatedAt: args.now,
    });
    return null;
  },
});

export const upsertTree = internalMutation({
  args: {
    owner: v.string(),
    repo: v.string(),
    sha: v.string(),
    fetchedAt: v.number(),
    fileCount: v.number(),
    truncated: v.boolean(),
    treeTruncated: v.boolean(),
    entries: v.array(v.object({ path: v.string(), type: v.string() })),
    etag: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("repoTrees")
      .withIndex("by_repo_sha", (q) =>
        q.eq("owner", args.owner).eq("repo", args.repo).eq("sha", args.sha),
      )
      .order("desc")
      .take(1);
    const doc = {
      owner: args.owner,
      repo: args.repo,
      sha: args.sha,
      fetchedAt: args.fetchedAt,
      fileCount: args.fileCount,
      truncated: args.truncated,
      treeTruncated: args.treeTruncated,
      entryCountStored: args.entries.length,
      entries: args.entries,
      etag: args.etag,
    };
    if (existing[0] !== undefined) {
      await ctx.db.patch("repoTrees", existing[0]._id, doc);
    } else {
      await ctx.db.insert("repoTrees", doc);
    }
    return null;
  },
});
