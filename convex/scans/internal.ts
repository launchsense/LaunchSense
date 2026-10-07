import { internalMutation, internalQuery } from "../_generated/server";
import { v } from "convex/values";
import { mayReuseInFlight } from "../identity/attribution";

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
  analyzerVersion: v.optional(v.string()),
  fetchedFileCount: v.optional(v.number()),
  skippedFileCount: v.optional(v.number()),
  progressFetched: v.optional(v.number()),
  progressTotal: v.optional(v.number()),
  progressPhase: v.optional(v.string()),
  analyzedAt: v.optional(v.number()),
  coverageNote: v.optional(v.string()),
  priorityOrder: v.optional(v.array(v.string())),
  prioritySource: v.optional(v.string()),
  priorityNote: v.optional(v.string()),
  suggestedLicence: v.optional(v.string()),
  suggestionSource: v.optional(v.string()),
  suggestionNote: v.optional(v.string()),
  liveUrl: v.optional(v.string()),
  mainAction: v.optional(v.string()),
  rescanOf: v.optional(v.id("scans")),
  surface: v.optional(v.union(v.literal("web"), v.literal("mcp_hosted"))),
  channel: v.optional(v.union(v.literal("web"), v.literal("mcp"), v.literal("api"))),
  attributedCallerId: v.optional(v.id("credentials")),
  attributed: v.optional(v.boolean()),
  commitSha: v.optional(v.string()),
  treeSha: v.optional(v.string()),
  signedIn: v.optional(v.boolean()),
  userId: v.optional(v.id("users")),
  createdAt: v.number(),
  updatedAt: v.number(),
});

const treeDoc = v.object({  _id: v.id("repoTrees"),
  _creationTime: v.number(),
  owner: v.string(),
  repo: v.string(),
  sha: v.string(),
  treeSha: v.optional(v.string()),
  fetchedAt: v.number(),
  fileCount: v.number(),
  truncated: v.boolean(),
  treeTruncated: v.boolean(),
  entryCountStored: v.number(),
  entries: v.array(v.object({ path: v.string(), type: v.string() })),
  etag: v.optional(v.string()),
});

/**
 * An in-flight scan of one repository, or null.
 *
 * The ownership rule is `mayReuseInFlight` and it is called, not restated. That
 * query used to match on (owner, repo) with no sha and no identity, and `runScan`
 * handed the row back once a sha was pinned, so a second caller scanning the same
 * public repository received a row that belonged to the first. Once a scan row is
 * attributed, that is not a shared cache entry, it is a scan owned by the wrong
 * person.
 *
 * A callerId here is a server-minted value, compared as a plain string. Nothing
 * the request carried reaches this argument except through a resolve.
 *
 * The candidate is still returned even when it does not belong, with `owned`
 * false, because the caller uses that to skip the reuse and mint its own row.
 * Returning null would hide the difference between "nothing is running" and
 * "something is running that is not yours".
 */
export const findInFlight = internalQuery({
  args: {
    owner: v.string(),
    repo: v.string(),
    sinceMs: v.number(),
    signedIn: v.boolean(),
    callerId: v.optional(v.string()),
  },
  returns: v.union(
    v.object({ scan: scanDoc, owned: v.boolean() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const recent = await ctx.db
      .query("scans")
      .withIndex("by_repo", (q) => q.eq("owner", args.owner).eq("repo", args.repo))
      .order("desc")
      .take(20);
    const callerId = args.callerId ?? null;
    let foreign: { scan: (typeof recent)[number]; owned: boolean } | null = null;
    for (const scan of recent) {
      const sameMode = (scan.signedIn === true) === args.signedIn;
      if (!sameMode) continue;
      if (scan.updatedAt < args.sinceMs) continue;
      if (scan.status !== "validating" && scan.status !== "fetching") continue;
      const owned = mayReuseInFlight(scan, callerId);
      if (owned) return { scan, owned: true };
      // Remember the first foreign row so the caller can tell the two apart.
      if (foreign === null) foreign = { scan, owned: false };
    }
    return foreign;
  },
});

export const findCachedScan = internalQuery({
  args: { owner: v.string(), repo: v.string(), sha: v.string(), sinceMs: v.number(), signedIn: v.boolean() },
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
      const sameMode = (scan.signedIn === true) === args.signedIn;
      if (sameMode && scan.updatedAt >= args.sinceMs && (scan.status === "completed" || scan.status === "partial")) {
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

/**
 * Mint a scan row.
 *
 * `attributed` is written on every row, true or false. It is not optional here:
 * a scan with no credential is a real scan and must be counted in the
 * denominator, so omitting the field would make attributed / total a ratio over
 * an unknown base rather than over every scan that happened.
 */
export const createScan = internalMutation({
  args: {
    owner: v.string(),
    repo: v.string(),
    repoUrl: v.string(),
    signedIn: v.boolean(),
    userId: v.optional(v.id("users")),
    /** Absent when no credential resolved. The field is what makes it absent. */
    attributedCallerId: v.optional(v.id("credentials")),
    /** Written true or false. Never left off. */
    attributed: v.boolean(),
    channel: v.union(v.literal("web"), v.literal("mcp"), v.literal("api")),
    surface: v.union(v.literal("web"), v.literal("mcp_hosted")),
    now: v.number(),
  },
  returns: v.id("scans"),
  handler: async (ctx, args) => {
    return await ctx.db.insert("scans", {
      owner: args.owner,
      repo: args.repo,
      repoUrl: args.repoUrl,
      status: "validating",
      signedIn: args.signedIn,
      userId: args.userId,
      attributedCallerId: args.attributedCallerId,
      attributed: args.attributed,
      channel: args.channel,
      surface: args.surface,
      createdAt: args.now,
      updatedAt: args.now,
    });
  },
});

/**
 * Record the two shas a scan stands on.
 *
 * commitSha and treeSha are separate fields because they are different values.
 * The tree response sha is the tree OBJECT sha, not the commit sha, so a naive
 * equality check between them would fail on every repository and a check that
 * ignores the difference proves nothing.
 *
 * treeSha is optional because a caller can return a tree body with no sha in it.
 * An absent value is a gap in the evidence, not a contradiction, and recording it
 * as such is honest. The two are compared against each other and against the
 * commit's own promised tree sha before this mutation is ever called, in
 * ./snapshot.ts, so a disagreement fails the scan rather than storing a snapshot
 * neither response supports.
 */
export const markShas = internalMutation({
  args: {
    scanId: v.id("scans"),
    commitSha: v.string(),
    treeSha: v.optional(v.string()),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("scans", args.scanId, {
      // The legacy `sha` stays as the commit sha. Many readers use it and it has
      // always meant that; the named field is the same value, spelled out.
      sha: args.commitSha,
      commitSha: args.commitSha,
      treeSha: args.treeSha,
      updatedAt: args.now,
    });
    return null;
  },
});

export const markProgress = internalMutation({
  args: {
    scanId: v.id("scans"),
    fetchedFileCount: v.number(),
    totalPlanned: v.number(),
    phase: v.optional(v.string()),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("scans", args.scanId, {
      progressFetched: args.fetchedFileCount,
      progressTotal: args.totalPlanned,
      progressPhase: args.phase ?? "fetching",
      updatedAt: args.now,
    });
    return null;
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
    treeSha: v.optional(v.string()),
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
      treeSha: args.treeSha,
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
