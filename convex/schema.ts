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
// Stage 4: live checks, share/passport artifacts, first-party analytics.
// Rescan: compare pairs, transitions, guest decisions.
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
    progressFetched: v.optional(v.number()),
    progressTotal: v.optional(v.number()),
    progressPhase: v.optional(v.string()),
    analyzedAt: v.optional(v.number()),
    coverageNote: v.optional(v.string()),
    liveUrl: v.optional(v.string()),
    mainAction: v.optional(v.string()),
    rescanOf: v.optional(v.id("scans")),
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
  })
    .index("by_repo_sha_path", ["owner", "repo", "sha", "path"])
    .index("by_owner_before", ["owner", "repo", "fetchedAt"]),
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
  liveChecks: defineTable({
    scanId: v.id("scans"),
    url: v.string(),
    finalUrl: v.optional(v.string()),
    https: v.boolean(),
    reaches: v.boolean(),
    httpStatus: v.optional(v.number()),
    nonBlank: v.optional(v.boolean()),
    mainActionFound: v.optional(v.boolean()),
    viewportMeta: v.optional(v.boolean()),
    hops: v.number(),
    errorKind: v.optional(scanErrorKind),
    errorMessage: v.optional(v.string()),
    checkedAt: v.number(),
  }).index("by_scan", ["scanId"]),
  shareArtifacts: defineTable({
    shareId: v.string(),
    scanId: v.id("scans"),
    createdAt: v.number(),
  })
    .index("by_shareId", ["shareId"])
    .index("by_scan", ["scanId"]),
  passportArtifacts: defineTable({
    passportId: v.string(),
    scanId: v.id("scans"),
    createdAt: v.number(),
  })
    .index("by_passportId", ["passportId"])
    .index("by_scan", ["scanId"]),
  // Admission control. Many visitors can land at once on sprint day, so scans
  // queue instead of all hitting GitHub together. One row per waiting scan.
  scanQueue: defineTable({
    scanId: v.id("scans"),
    owner: v.string(),
    repo: v.string(),
    queuedAt: v.number(),
    // Convex forbids optional fields in an index, so a waiting entry uses 0
    // rather than being absent. Anything non-zero is a started slot.
    startedAt: v.number(),
  })
    .index("by_queue", ["startedAt", "queuedAt"])
    .index("by_repo", ["owner", "repo"]),
  // Live GitHub quota mirror, updated by every fetch. Read by the browser so
  // users can see what is left and when it resets.
  quotaState: defineTable({
    remaining: v.number(),
    limit: v.number(),
    resetAt: v.number(),
    updatedAt: v.number(),
  }).index("by_updated", ["updatedAt"]),
  rateLimits: defineTable({
    key: v.string(),
    day: v.string(),
    count: v.number(),
    updatedAt: v.number(),
  }).index("by_key", ["key"]).index("by_day", ["day"]),
  analyticsEvents: defineTable({
    day: v.string(),
    kind: v.union(
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
    ),
    scanId: v.optional(v.id("scans")),
    shareId: v.optional(v.string()),
    refShareId: v.optional(v.string()),
    createdAt: v.number(),
  }).index("by_day", ["day"]),
  findingTransitions: defineTable({
    fromScanId: v.id("scans"),
    toScanId: v.id("scans"),
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
    createdAt: v.number(),
  }).index("by_pair", ["fromScanId", "toScanId"]),
  userDecisions: defineTable({
    scanId: v.id("scans"),
    fingerprint: v.string(),
    decision: v.union(v.literal("accepted_risk")),
    createdAt: v.number(),
  }).index("by_scan", ["scanId"]),
});
