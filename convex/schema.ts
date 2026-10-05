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
// Wave 6: hosted MCP usage events and the daily rollup, no scan surface split yet.
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
    /** Ordered actional fingerprints, most urgent first, from the decision lane or the table floor. */
    priorityOrder: v.optional(v.array(v.string())),
    /** Which rung produced the order: jev, perplexity, or table. Never a model name. */
    prioritySource: v.optional(v.string()),
    priorityNote: v.optional(v.string()),
    liveUrl: v.optional(v.string()),
    mainAction: v.optional(v.string()),
    rescanOf: v.optional(v.id("scans")),
    /** Which surface accepted the repo. Optional: nothing wrote it before the
     * analytics lane existed, and a scan is a scan either way. */
    surface: v.optional(v.union(v.literal("web"), v.literal("mcp_hosted"))),
    /** True when this scan used the signed-in GitHub token and the higher file cap. */
    signedIn: v.optional(v.boolean()),
    /** Owner of a signed-in scan. Absent on guest scans of public repos. */
    userId: v.optional(v.id("users")),
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
  // GitHub user token for one signed-in archive download. Never returned to the browser.
  githubScanTokens: defineTable({
    userId: v.id("users"),
    accessToken: v.string(),
    updatedAt: v.number(),
  }).index("by_user", ["userId"]),
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
  usageDiagnostics: defineTable({
    day: v.string(),
    stage: v.string(),
    tier: v.string(),
    harness: v.string(),
    version: v.string(),
    durationMs: v.number(),
    orderSource: v.string(),
    ruleCounts: v.string(),
    createdAt: v.number(),
  }).index("by_day", ["day"]),
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
  // Analytics for the hosted MCP surface only. One row per protocol action, so
  // the question "which harness calls us, which tool, how often" has an answer.
  // Twelve of the sixteen product events are derived from scans and
  // findingTransitions instead of written here; only the three MCP rows need a
  // write, and the nightly rollup deletes these after 30 days.
  //
  // Two fields are deliberate refusals rather than gaps:
  //   repoKey is HMAC(secret, day + "owner/repo"), never the literal. A raw
  //     private repo name beside a stable caller id is an inventory of whose
  //     code you read, and the day inside the signed message means the hash
  //     cannot be joined across days.
  //   clientName is client-declared, so it is mapped through a fixed allowlist
  //     before it lands. Storing it raw lets one caller mint a new dimension per
  //     request and make the table impossible to aggregate.
  usageEvents: defineTable({
    day: v.string(),
    kind: v.union(
      v.literal("mcp_session_initialized"),
      v.literal("mcp_tools_listed"),
      v.literal("mcp_tool_called"),
    ),
    surface: v.literal("mcp_hosted"),
    /** Allowlisted, so this column holds at most eight distinct values. */
    clientName: v.string(),
    clientVersion: v.optional(v.string()),
    /** OpenTelemetry mcp.protocol.version. */
    protocolVersion: v.optional(v.string()),
    /** OpenTelemetry mcp.method.name: initialize, tools/list, tools/call. */
    mcpMethodName: v.optional(v.string()),
    /** OpenTelemetry gen_ai.tool.name. Never the tool arguments. */
    toolName: v.optional(v.string()),
    /** ok, tool_error, protocol_error, quota_denied. Checked at the write path. */
    outcome: v.string(),
    /** OpenTelemetry error.type. A low-cardinality enum, never raw error text. */
    errorType: v.optional(v.string()),
    /** OpenTelemetry rpc.response.status.code, so -32600 and -32602 stay countable. */
    rpcResponseStatusCode: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    scanId: v.optional(v.id("scans")),
    repoKey: v.optional(v.string()),
    createdAt: v.number(),
  })
    .index("by_day", ["day"])
    .index("by_kind_day", ["kind", "day"]),
  // The only table a reader touches. The nightly rollup folds yesterday's raw
  // rows and yesterday's scan and transition facts into a few hundred rows here,
  // so dashboard cost stays flat while raw volume grows. dims is a low-cardinality
  // JSON object (client, tool, outcome, surface, status, cause) and never holds
  // a repo name, a path, a title, or free text of any kind.
  dailyMetrics: defineTable({
    day: v.string(),
    metric: v.string(),
    dims: v.string(),
    count: v.number(),
    ratio: v.optional(v.number()),
    createdAt: v.number(),
  })
    .index("by_day", ["day"])
    .index("by_metric_day", ["metric", "day"]),
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
  projects: defineTable({
    userId: v.id("users"),
    owner: v.string(),
    repo: v.string(),
    connectedAt: v.number(),
    lastScanAt: v.optional(v.number()),
  }).index("by_user", ["userId"]),
  connectedInstallations: defineTable({
    userId: v.id("users"),
    installationId: v.string(),
    account: v.string(),
    repoSelection: v.string(),
    installationTargetId: v.string(),
    connectedAt: v.number(),
  }).index("by_user", ["userId"]),
  featureEntitlements: defineTable({
    userId: v.id("users"),
    featureKey: v.literal("rendered_phone_check"),
    enabled: v.boolean(),
    source: v.union(v.literal("paid"), v.literal("permitted")),
    expiresAt: v.optional(v.number()),
    grantedBy: v.string(),
    updatedAt: v.number(),
  })
    .index("by_user_feature", ["userId", "featureKey"])
    .index("by_feature", ["featureKey"]),
  usageMeters: defineTable({
    userId: v.id("users"),
    kind: v.union(v.literal("guest"), v.literal("signed_in"), v.literal("connected")),
    day: v.string(),
    count: v.number(),
    limit: v.number(),
  }).index("by_user_day", ["userId", "day", "kind"]),
  providerCalls: defineTable({
    scanId: v.id("scans"),
    kind: v.union(v.literal("explain"), v.literal("decide")),
    source: v.union(
      v.literal("gemini"),
      v.literal("ollama"),
      v.literal("openrouter"),
      v.literal("jev"),
      v.literal("perplexity"),
      v.literal("deterministic"),
      v.literal("table"),
    ),
    model: v.optional(v.string()),
    latencyMs: v.number(),
    promptHash: v.string(),
    inputTokens: v.optional(v.number()),
    outputTokens: v.optional(v.number()),
    totalTokens: v.optional(v.number()),
    ok: v.boolean(),
    errorKind: v.optional(v.string()),
    day: v.string(),
    createdAt: v.number(),
  })
    .index("by_scan", ["scanId"])
    .index("by_day_source", ["day", "source"]),
});
