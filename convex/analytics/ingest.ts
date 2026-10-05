import { internalMutation } from "../_generated/server";
import { v } from "convex/values";
import { allowlistedClientName } from "../mcpHttp";
import { forbiddenPropertiesIn } from "./privacy";

// Analytics ingest for the hosted MCP surface. One row per protocol action.
//
// The write is deliberately unmetered by the per-kind daily cap that `logEvent`
// enforces. That cap is right for a share view and arithmetically impossible for
// tool-call volume: a caller making 200 calls a day would be recorded as 50, and
// the rollup would report a number that is wrong rather than small. The hosted
// lane is bounded by CALLER_LIMIT and GLOBAL_LIMIT in mcpLimit.ts instead, which
// is the bound that is actually about cost.
//
// The share-event cap is unchanged. Nothing here reads or writes rateLimits.

const eventKind = v.union(
  v.literal("mcp_session_initialized"),
  v.literal("mcp_tools_listed"),
  v.literal("mcp_tool_called"),
);

const eventOutcome = v.union(
  v.literal("ok"),
  v.literal("tool_error"),
  v.literal("protocol_error"),
  v.literal("quota_denied"),
);

export const recordMcpUsageEvent = internalMutation({
  args: {
    kind: eventKind,
    // clientName is allowlisted again here rather than trusted from the caller.
    // Two checks in two places, because one of them is the only thing between a
    // client-declared string and a column that is meant to hold eight values.
    clientName: v.string(),
    clientVersion: v.optional(v.string()),
    protocolVersion: v.optional(v.string()),
    mcpMethodName: v.optional(v.string()),
    toolName: v.optional(v.string()),
    outcome: eventOutcome,
    errorType: v.optional(v.string()),
    rpcResponseStatusCode: v.optional(v.number()),
    durationMs: v.optional(v.number()),
    repoKey: v.optional(v.string()),
    now: v.optional(v.number()),
  },
  returns: v.object({ stored: v.boolean(), reason: v.string() }),
  handler: async (ctx, args) => {
    const now = args.now ?? Date.now();
    const day = new Date(now).toISOString().slice(0, 10);
    const clientName = allowlistedClientName(args.clientName);
    // A mapped name is always in the allowlist, so this is a live check rather
    // than a formality: it is what stops a wider clientName column if the mapper
    // is ever loosened.
    if (clientName.length === 0) {
      return { stored: false, reason: "client_not_allowlisted" };
    }
    if (args.clientVersion !== undefined && !/^[A-Za-z0-9.+_-]{1,32}$/.test(args.clientVersion)) {
      return { stored: false, reason: "client_version_shape" };
    }
    // repoKey is a hash or it is nothing. A raw owner/repo string reaching this
    // argument is refused outright rather than trimmed or escaped.
    if (args.repoKey !== undefined && !/^[0-9a-f]{64}$/.test(args.repoKey)) {
      return { stored: false, reason: "repo_key_shape" };
    }
    const doc = {
      day,
      kind: args.kind,
      surface: "mcp_hosted" as const,
      clientName,
      clientVersion: args.clientVersion,
      protocolVersion: args.protocolVersion,
      mcpMethodName: args.mcpMethodName,
      toolName: args.toolName,
      outcome: args.outcome,
      errorType: args.errorType,
      rpcResponseStatusCode: args.rpcResponseStatusCode,
      durationMs: args.durationMs,
      repoKey: args.repoKey,
      createdAt: now,
    };
    // Belt and braces. The arg validator already refuses an unknown property, so
    // this can only fire if a field is added carelessly later. It runs before the
    // insert, which is the only point at which it can still prevent a write.
    if (forbiddenPropertiesIn(doc).length > 0) {
      return { stored: false, reason: "forbidden_property" };
    }
    await ctx.db.insert("usageEvents", doc);
    return { stored: true, reason: "stored" };
  },
});

export { FORBIDDEN_PROPERTIES, forbiddenPropertiesIn, repoKeyFor } from "./privacy";