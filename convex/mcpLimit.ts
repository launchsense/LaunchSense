import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";

const CALLER_LIMIT = 2;
const GLOBAL_LIMIT = 8;
const USAGE_CALLER_LIMIT = 20;

// The usage route writes into the diagnostics table, so it needs a credential.
// The expected value is a deployment secret read from the environment; it is
// never returned, logged, or stored. An unset or empty expected value rejects
// every caller, so a deployment that has not set one cannot be written to.
export const USAGE_KEY_HEADER = "x-launchsense-usage-key";

export function usageKeyMatches(provided: string | null, expected: string | undefined): boolean {
  if (typeof expected !== "string" || expected.length === 0) return false;
  if (typeof provided !== "string" || provided.length !== expected.length) return false;
  // Constant-time over equal-length inputs, so a mismatch does not leak how
  // many leading characters were right.
  let diff = 0;
  for (let i = 0; i < expected.length; i += 1) {
    diff |= provided.charCodeAt(i) ^ expected.charCodeAt(i);
  }
  return diff === 0;
}

async function bump(ctx: MutationCtx, key: string, day: string, limit: number, now: number): Promise<boolean> {
  const existing = await ctx.db.query("rateLimits").withIndex("by_key", (q) => q.eq("key", key)).unique();
  if (existing !== null && existing.count >= limit) return false;
  if (existing !== null) {
    await ctx.db.patch("rateLimits", existing._id, { count: existing.count + 1, updatedAt: now });
  } else {
    await ctx.db.insert("rateLimits", { key, day, count: 1, updatedAt: now });
  }
  return true;
}

export const consumeMcpScan = internalMutation({
  args: { caller: v.string() },
  returns: v.object({ allowed: v.boolean() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const hour = new Date(now).toISOString().slice(0, 13);
    const day = hour.slice(0, 10);
    const caller = args.caller.slice(0, 80) || "unknown";
    const globalOk = await bump(ctx, `mcp-scan-global:${hour}`, day, GLOBAL_LIMIT, now);
    if (!globalOk) return { allowed: false };
    const callerOk = await bump(ctx, `mcp-scan:${hour}:${caller}`, day, CALLER_LIMIT, now);
    return { allowed: callerOk };
  },
});

// Per-caller write cap for the usage route. Separate from the scan limits so a
// noisy usage reporter cannot spend the scan quota, and so the cap can be read
// on its own.
export const consumeUsageWrite = internalMutation({
  args: { caller: v.string() },
  returns: v.object({ allowed: v.boolean() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const hour = new Date(now).toISOString().slice(0, 13);
    const day = hour.slice(0, 10);
    const caller = args.caller.slice(0, 80) || "unknown";
    const allowed = await bump(ctx, `mcp-usage:${hour}:${caller}`, day, USAGE_CALLER_LIMIT, now);
    return { allowed };
  },
});

// The explain lane spends a provider call per press, so a scan id alone must not
// be able to ask for one over and over. Same table, same bump helper, same hourly
// window as the limits above: one cap per scan, one cap per caller. A guest has
// no account to key a caller bucket on, so its caller bucket is its own scan, and
// the per-scan cap is then the whole cap for that visitor.
export const EXPLAIN_SCAN_LIMIT = 2;
export const EXPLAIN_CALLER_LIMIT = 12;

/** The bucket a caller spends from. An account id, or the scan when there is none. */
export function explainCallerKey(caller: string | null, scanId: string): string {
  const who = caller === null || caller.length === 0 ? `scan:${scanId}` : `user:${caller}`;
  return who.slice(0, 80);
}

/**
 * Claim one explain slot. Both caps must pass, and neither is taken from the
 * caller's word for it: a scan id and an account id are all this reads.
 */
export const consumeExplain = internalMutation({
  args: { scanId: v.id("scans"), caller: v.optional(v.string()) },
  returns: v.object({ allowed: v.boolean(), reason: v.string() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const hour = new Date(now).toISOString().slice(0, 13);
    const day = hour.slice(0, 10);
    // Per scan first. A scan id is the only credential a guest holds, so this is
    // the cap that has to hold when nothing else is known about the caller.
    const scanOk = await bump(ctx, `explain:${hour}:scan:${args.scanId}`, day, EXPLAIN_SCAN_LIMIT, now);
    if (!scanOk) return { allowed: false, reason: "scan_limit" };
    const caller = explainCallerKey(args.caller ?? null, args.scanId);
    const callerOk = await bump(ctx, `explain:${hour}:caller:${caller}`, day, EXPLAIN_CALLER_LIMIT, now);
    if (!callerOk) return { allowed: false, reason: "caller_limit" };
    return { allowed: true, reason: "allowed" };
  },
});

export const recordUsage = internalMutation({
  args: {
    stage: v.string(),
    tier: v.string(),
    harness: v.string(),
    version: v.string(),
    durationMs: v.number(),
    orderSource: v.string(),
    ruleCounts: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    if (args.tier === "enterprise") return null;
    if (args.ruleCounts.length > 4000) return null;
    if (/\/|function |eval\(|-----BEGIN/.test(args.ruleCounts)) return null;
    await ctx.db.insert("usageDiagnostics", {
      day: new Date().toISOString().slice(0, 10),
      stage: args.stage.slice(0, 20),
      tier: args.tier.slice(0, 20),
      harness: args.harness.slice(0, 40),
      version: args.version.slice(0, 40),
      durationMs: args.durationMs,
      orderSource: args.orderSource.slice(0, 20),
      ruleCounts: args.ruleCounts,
      createdAt: Date.now(),
    });
    return null;
  },
});
