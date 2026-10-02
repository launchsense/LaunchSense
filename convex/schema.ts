import { defineSchema, defineTable } from "convex/server";
import { authTables } from "@convex-dev/auth/server";
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

// Product tables are added alongside the features that need them.
// Stage 2 only: guest scan rows + cached recursive trees. No auth-owned
// projects, findings, or analytics yet.
export default defineSchema({
  ...authTables,
  scans: defineTable({
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
  })
    // by_repo is intentional: in-flight scans have no sha yet and are excluded
    // from by_repo_sha, so prefix-only queries need their own index.
    // eslint-disable-next-line @convex-dev/no-duplicate-indexes
    .index("by_repo", ["owner", "repo"])
    .index("by_repo_sha", ["owner", "repo", "sha"]),
  repoTrees: defineTable({
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
  }).index("by_repo_sha", ["owner", "repo", "sha"]),
});
