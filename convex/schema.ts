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

const severity = v.union(
  v.literal("high"),
  v.literal("medium"),
  v.literal("low"),
  v.literal("info"),
);

// Product tables are added alongside the features that need them.
// Stage 2: guest scan rows + cached recursive trees.
// Stage 3: bounded file contents, OSV cache, evidence ledger, findings.
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
    analyzerVersion: v.optional(v.string()),
    fetchedFileCount: v.optional(v.number()),
    skippedFileCount: v.optional(v.number()),
    analyzedAt: v.optional(v.number()),
    coverageNote: v.optional(v.string()),
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
  fileContents: defineTable({
    owner: v.string(),
    repo: v.string(),
    sha: v.string(),
    path: v.string(),
    contentSha: v.string(),
    size: v.number(),
    truncated: v.boolean(),
    fetchedAt: v.number(),
    content: v.string(),
  }).index("by_repo_sha_path", ["owner", "repo", "sha", "path"]),
  osvCache: defineTable({
    ecosystem: v.string(),
    name: v.string(),
    version: v.string(),
    checkedAt: v.number(),
    timedOut: v.boolean(),
    vulns: v.array(
      v.object({ id: v.string(), summary: v.string(), severity: v.string() }),
    ),
  }).index("by_package", ["ecosystem", "name", "version"]),
  evidenceItems: defineTable({
    scanId: v.id("scans"),
    ruleId: v.string(),
    analyzerVersion: v.string(),
    path: v.string(),
    line: v.number(),
    contentHash: v.string(),
    redactedSnippet: v.string(),
    severity,
    createdAt: v.number(),
  }).index("by_scan", ["scanId"]),
  findings: defineTable({
    scanId: v.id("scans"),
    ruleId: v.string(),
    analyzerVersion: v.string(),
    fingerprint: v.string(),
    path: v.string(),
    line: v.number(),
    severity,
    title: v.string(),
    why: v.string(),
    bucket: v.union(v.literal("actionable"), v.literal("info")),
    createdAt: v.number(),
  }).index("by_scan", ["scanId"]),
});
