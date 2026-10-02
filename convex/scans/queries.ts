import { query } from "../_generated/server";
import { v } from "convex/values";

export const getScan = query({
  args: { scanId: v.id("scans") },
  returns: v.object({
    scan: v.union(
      v.object({
        _id: v.id("scans"),
        _creationTime: v.number(),
        owner: v.string(),
        repo: v.string(),
        repoUrl: v.string(),
        status: v.union(
          v.literal("validating"),
          v.literal("fetching"),
          v.literal("completed"),
          v.literal("partial"),
          v.literal("failed"),
        ),
        sha: v.optional(v.string()),
        defaultBranch: v.optional(v.string()),
        fileCount: v.optional(v.number()),
        truncated: v.optional(v.boolean()),
        treeTruncated: v.optional(v.boolean()),
        errorKind: v.optional(
          v.union(
            v.literal("invalid_url"),
            v.literal("not_found"),
            v.literal("rate_limited"),
            v.literal("truncated"),
            v.literal("network"),
            v.literal("unknown"),
          ),
        ),
        errorMessage: v.optional(v.string()),
        rateLimitResetAt: v.optional(v.number()),
        createdAt: v.number(),
        updatedAt: v.number(),
      }),
      v.null(),
    ),
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
