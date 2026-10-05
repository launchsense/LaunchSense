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
