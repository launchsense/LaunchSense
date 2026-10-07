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
  signedIn: v.optional(v.boolean()),
  // The fetched shape must declare every field the schema can hold. A Convex
  // return validator rejects a document that carries a field it does not name,
  // so an omission here makes fetchScan throw on a real row, in every lane that
  // reads it. These fields were added to the schema after this shape was written
  // and were missing, which broke the read on every row createScan writes.
  userId: v.optional(v.id("users")),
  attributedCallerId: v.optional(v.id("credentials")),
  attributed: v.optional(v.boolean()),
  channel: v.optional(v.union(v.literal("web"), v.literal("mcp"), v.literal("api"))),
  surface: v.optional(v.union(v.literal("web"), v.literal("mcp_hosted"))),
  commitSha: v.optional(v.string()),
  treeSha: v.optional(v.string()),
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

// Metadata only. File bodies are NEVER stored and never returned: caching a
// redacted body and feeding it back to the analyzers silently destroyed the
// exact patterns the secret checks look for, so a repeat scan of the same
// commit reported fewer secrets than the first one.
export const getCachedMeta = internalQuery({
  args: {
    owner: v.string(),
    repo: v.string(),
    sha: v.string(),
    path: v.string(),
    sinceMs: v.number(),
  },
  returns: v.union(
    v.object({
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
    return { size: hit.size, contentSha: hit.contentSha };
  },
});

// Retention is enforced here, not just on read. Called at the start of every
// analyze run, so cached text is deleted once its window has passed even when
// no cron is configured.
// Migration support. Rows written before the `content` field was removed from
// the schema still carry file text, because Convex does not drop fields from
// existing documents. This deletes them in batches.

export const purgeStaleContents = internalMutation({
  args: { owner: v.string(), repo: v.string(), beforeMs: v.number() },
  returns: v.number(),
  handler: async (ctx, args) => {
    const stale = await ctx.db
      .query("fileContents")
      .withIndex("by_owner_before", (q) =>
        q.eq("owner", args.owner).eq("repo", args.repo).lt("fetchedAt", args.beforeMs),
      )
      .order("asc")
      .take(500);
    for (const row of stale) await ctx.db.delete("fileContents", row._id);
    return stale.length;
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
    // No file body is stored. Size and content hash are enough to detect a
    // changed file and to compute coverage honestly.
    const doc = {
      owner: args.owner,
      repo: args.repo,
      sha: args.sha,
      path: args.path,
      contentSha: args.contentSha,
      size: args.size,
      truncated: args.truncated,
      fetchedAt: args.fetchedAt,
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
      progressFetched: args.fetchedFileCount,
      progressTotal: args.fetchedFileCount + args.skippedFileCount,
      progressPhase: "done",
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

export const setLiveInputs = internalMutation({
  args: {
    scanId: v.id("scans"),
    liveUrl: v.optional(v.string()),
    mainAction: v.optional(v.string()),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("scans", args.scanId, {
      liveUrl: args.liveUrl,
      mainAction: args.mainAction,
      updatedAt: args.now,
    });
    return null;
  },
});

export const saveLiveCheck = internalMutation({
  args: {
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
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("liveChecks")
      .withIndex("by_scan", (q) => q.eq("scanId", args.scanId))
      .order("desc")
      .take(1);
    const doc = {
      scanId: args.scanId,
      url: args.url,
      finalUrl: args.finalUrl,
      https: args.https,
      reaches: args.reaches,
      httpStatus: args.httpStatus,
      nonBlank: args.nonBlank,
      mainActionFound: args.mainActionFound,
      viewportMeta: args.viewportMeta,
      hops: args.hops,
      errorKind: args.errorKind,
      errorMessage: args.errorMessage,
      checkedAt: args.checkedAt,
    };
    if (existing[0] !== undefined) {
      await ctx.db.patch("liveChecks", existing[0]._id, doc);
    } else {
      await ctx.db.insert("liveChecks", doc);
    }
    return null;
  },
});

export const saveShare = internalMutation({
  args: { shareId: v.string(), scanId: v.id("scans"), now: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("shareArtifacts")
      .withIndex("by_shareId", (q) => q.eq("shareId", args.shareId))
      .order("desc")
      .take(1);
    if (existing[0] === undefined) {
      await ctx.db.insert("shareArtifacts", {
        shareId: args.shareId,
        scanId: args.scanId,
        createdAt: args.now,
      });
    }
    return null;
  },
});

export const findShare = internalQuery({
  args: { shareId: v.string() },
  returns: v.union(
    v.object({ shareId: v.string(), scanId: v.id("scans"), createdAt: v.number() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("shareArtifacts")
      .withIndex("by_shareId", (q) => q.eq("shareId", args.shareId))
      .order("desc")
      .take(1);
    const hit = matches[0] ?? null;
    if (hit === null) return null;
    return { shareId: hit.shareId, scanId: hit.scanId, createdAt: hit.createdAt };
  },
});

export const savePassport = internalMutation({
  args: { passportId: v.string(), scanId: v.id("scans"), now: v.number() },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("passportArtifacts")
      .withIndex("by_passportId", (q) => q.eq("passportId", args.passportId))
      .order("desc")
      .take(1);
    if (existing[0] === undefined) {
      await ctx.db.insert("passportArtifacts", {
        passportId: args.passportId,
        scanId: args.scanId,
        createdAt: args.now,
      });
    }
    return null;
  },
});

export const findPassport = internalQuery({
  args: { passportId: v.string() },
  returns: v.union(
    v.object({ passportId: v.string(), scanId: v.id("scans"), createdAt: v.number() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    const matches = await ctx.db
      .query("passportArtifacts")
      .withIndex("by_passportId", (q) => q.eq("passportId", args.passportId))
      .order("desc")
      .take(1);
    if (matches[0] === undefined) return null;
    return {
      passportId: matches[0].passportId,
      scanId: matches[0].scanId,
      createdAt: matches[0].createdAt,
    };
  },
});

const transitionState = v.union(
  v.literal("fixed"),
  v.literal("still_broken"),
  v.literal("new"),
  v.literal("regressed"),
  v.literal("unknown"),
);

// `license_change` was added with the licence declaration lane, so a
// re-licensed dependency is reported as a licence change rather than as a code
// change. The state machine is unchanged; this is one more reason on a row the
// same machinery already writes.
const changeCause = v.union(
  v.literal("code_change"),
  v.literal("advisory_update"),
  v.literal("analyzer_update"),
  v.literal("license_change"),
);

/**
 * Mint the row a rescan writes into.
 *
 * `attributed` is written on every row for the same reason as createScan: an
 * unattributed rescan still happened and still belongs in the denominator.
 * `channel` and `surface` are recorded too, because a rescan is a scan and the
 * funnel would otherwise undercount every one of them.
 *
 * `liveUrl` and `mainAction` are the parent's live target, carried forward. A
 * rescan answers "is the thing still broken on the same code", so losing the
 * site under test would silently change the question into a different one. The
 * caller passes the parent's values rather than this mutation re-reading the
 * parent: `rescanScan` already holds that row, has already refused to proceed
 * unless it is analyzed, and re-reading it here would be a second read of a row
 * the caller has in hand. A parent with no live target carries nothing, so the
 * child has none.
 */
export const createRescan = internalMutation({
  args: {
    owner: v.string(),
    repo: v.string(),
    repoUrl: v.string(),
    rescanOf: v.id("scans"),
    liveUrl: v.optional(v.string()),
    mainAction: v.optional(v.string()),
    signedIn: v.boolean(),
    userId: v.optional(v.id("users")),
    attributedCallerId: v.optional(v.id("credentials")),
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
      liveUrl: args.liveUrl,
      mainAction: args.mainAction,
      rescanOf: args.rescanOf,
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

export const saveTransitions = internalMutation({
  args: {
    fromScanId: v.id("scans"),
    toScanId: v.id("scans"),
    now: v.number(),
    transitions: v.array(
      v.object({
        oldFingerprint: v.optional(v.string()),
        newFingerprint: v.optional(v.string()),
        ruleId: v.string(),
        state: transitionState,
        cause: v.optional(changeCause),
      }),
    ),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("findingTransitions")
      .withIndex("by_pair", (q) => q.eq("fromScanId", args.fromScanId).eq("toScanId", args.toScanId))
      .order("desc")
      .take(1000);
    for (const row of existing) await ctx.db.delete("findingTransitions", row._id);
    for (const t of args.transitions) {
      await ctx.db.insert("findingTransitions", {
        fromScanId: args.fromScanId,
        toScanId: args.toScanId,
        oldFingerprint: t.oldFingerprint,
        newFingerprint: t.newFingerprint,
        ruleId: t.ruleId,
        state: t.state,
        cause: t.cause,
        createdAt: args.now,
      });
    }
    return null;
  },
});

export const listTransitions = internalQuery({
  args: { fromScanId: v.id("scans"), toScanId: v.id("scans") },
  returns: v.array(
    v.object({
      oldFingerprint: v.optional(v.string()),
      newFingerprint: v.optional(v.string()),
      ruleId: v.string(),
      state: transitionState,
      cause: v.optional(changeCause),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("findingTransitions")
      .withIndex("by_pair", (q) => q.eq("fromScanId", args.fromScanId).eq("toScanId", args.toScanId))
      .order("desc")
      .take(1000);
    return rows.map((r) => ({
      oldFingerprint: r.oldFingerprint,
      newFingerprint: r.newFingerprint,
      ruleId: r.ruleId,
      state: r.state,
      cause: r.cause,
    }));
  },
});

export const saveDecision = internalMutation({
  args: {
    scanId: v.id("scans"),
    fingerprint: v.string(),
    decision: v.union(v.literal("accepted_risk")),
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query("userDecisions")
      .withIndex("by_scan", (q) => q.eq("scanId", args.scanId))
      .order("desc")
      .take(200);
    for (const row of existing) {
      if (row.fingerprint === args.fingerprint) {
        await ctx.db.patch("userDecisions", row._id, {
          decision: args.decision,
          createdAt: args.now,
        });
        return null;
      }
    }
    await ctx.db.insert("userDecisions", {
      scanId: args.scanId,
      fingerprint: args.fingerprint,
      decision: args.decision,
      createdAt: args.now,
    });
    return null;
  },
});

export const listDecisions = internalQuery({
  args: { scanId: v.id("scans") },
  returns: v.array(v.object({ fingerprint: v.string() })),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("userDecisions")
      .withIndex("by_scan", (q) => q.eq("scanId", args.scanId))
      .order("desc")
      .take(200);
    return rows.map((r) => ({ fingerprint: r.fingerprint }));
  },
});

export const listScanContents = internalQuery({
  args: { owner: v.string(), repo: v.string(), sha: v.string() },
  returns: v.array(v.object({ path: v.string(), contentSha: v.string() })),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query("fileContents")
      .withIndex("by_repo_sha_path", (q) =>
        q.eq("owner", args.owner).eq("repo", args.repo).eq("sha", args.sha),
      )
      .order("desc")
      .take(500);
    return rows.map((r) => ({ path: r.path, contentSha: r.contentSha }));
  },
});

/**
 * Persist the ordering the decision lane (or the table floor) produced.
 *
 * Only the order and its provenance are stored. The findings themselves are never
 * touched by this, which is the point: the lane orders, the checks decide.
 */
export const savePriority = internalMutation({
  args: {
    scanId: v.id("scans"),
    order: v.array(v.string()),
    source: v.string(),
    note: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.patch("scans", args.scanId, {
      priorityOrder: args.order,
      prioritySource: args.source,
      priorityNote: args.note,
      updatedAt: Date.now(),
    });
    return null;
  },
});

/**
 * Persist the licence suggestion.
 *
 * Only the pick, its provenance, and one template-built line are stored. The
 * suggestion never becomes a finding, a severity, or a licence fact, and the
 * declaration rows it was read from are untouched.
 */
export const saveLicenceSuggestion = internalMutation({
  args: {
    scanId: v.id("scans"),
    suggestedLicence: v.string(),
    suggestionSource: v.string(),
    suggestionNote: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.suggestedLicence.length > 80 || args.suggestionSource.length > 20) return null;
    if (args.suggestionNote.length > 500) return null;
    await ctx.db.patch("scans", args.scanId, {
      suggestedLicence: args.suggestedLicence,
      suggestionSource: args.suggestionSource,
      suggestionNote: args.suggestionNote,
      updatedAt: Date.now(),
    });
    return null;
  },
});

export const saveProviderCall = internalMutation({
  args: {
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
    now: v.number(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    await ctx.db.insert("providerCalls", {
      scanId: args.scanId,
      kind: args.kind,
      source: args.source,
      model: args.model,
      latencyMs: args.latencyMs,
      promptHash: args.promptHash,
      inputTokens: args.inputTokens,
      outputTokens: args.outputTokens,
      totalTokens: args.totalTokens,
      ok: args.ok,
      errorKind: args.errorKind,
      day: new Date(args.now).toISOString().slice(0, 10),
      createdAt: args.now,
    });
    return null;
  },
});
