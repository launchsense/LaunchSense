import { internalMutation } from "./_generated/server";
import type { MutationCtx } from "./_generated/server";
import { v } from "convex/values";
import { CALLER_DAILY_LIMIT, hostedHourlyLimit, hostedScanKeys } from "./identity/quotaKey";

// Hosted scan caps, set for the pilot: a group of about ten builders testing
// the hosted MCP for the next two months, then a wider group.
//
// Both numbers are a pilot policy with no traffic measurement behind them
// (unknown). Nothing counts hosted traffic today. The load handler that would
// read the rateLimits table by hour, and turn these into a measured ceiling,
// is a later unit and is not built. Until it is, treat the numbers as a
// policy choice, not as a measured limit, and say so in any document that
// repeats them.
//
// CALLER_LIMIT is the shared hosted bucket every identity-less caller spends
// from. 200 an hour is about ten builders at twenty scans an hour each. It is
// the cap for the whole group, so one noisy anonymous caller can spend everyone's
// budget; that is the honest cost while hosted identity is new, and it is why
// the per-caller caps below are what a resolved credential actually gets.
// GLOBAL_LIMIT is the lane total and sits above every other cap, so a bucket
// binds first and the total is the backstop that keeps one bad hour from
// spending the GitHub quota.
export const CALLER_LIMIT = 200;
export const GLOBAL_LIMIT = 600;
// The usage route is credentialed, so its bucket is keyed on the route, not on
// the caller address. The number is unchanged from the old per-caller value:
// one shared bucket of 20 an hour is a tighter ceiling for a single install
// and a looser one for a group, and 20 an hour across every install is still
// well above what a local review produces.
export const USAGE_LANE_LIMIT = 20;

/**
 * The hosted scan quota now keys on identity, not on a network address.
 *
 * The routes used to put the raw `x-forwarded-for` value into these keys, which
 * wrote a personal identifier into `rateLimits` and nothing in the repo ever
 * deleted those rows. Removing it closed two failures that shared one input.
 * Privacy: no stored key holds any part of a caller's address, so there is
 * nothing to retain and nothing to purge. Abuse: the header is client
 * controlled, so keying on it let a caller mint a fresh budget by rotating one
 * header value, while every builder behind one office egress shared a bucket.
 *
 * What replaces it is a server-minted callerId resolved from a bearer token.
 * The key rules live in ./identity/quotaKey so they can be tested directly:
 *
 *   resolved credential  its own bucket, hourly and per day
 *   no credential        the one shared bucket, hourly only
 *
 * An unrecognised callerId falls to the shared bucket rather than minting a
 * bucket of its own, so a malformed value cannot become a fresh budget. And a
 * declared harness label never reaches a key: it is a claim, and one caller
 * sending a fresh label per request would otherwise get a fresh budget per
 * request.
 *
 * HOSTED_CALLER_BUCKET is re-exported from that module so the existing callers
 * and the tests that name it keep working.
 */
export {
  HOSTED_CALLER_BUCKET,
  CALLER_HOURLY_LIMIT,
  CALLER_DAILY_LIMIT,
  SHARED_HOURLY_LIMIT,
  hostedCallerBucket,
  hostedHourlyLimit,
  hostedScanKeys,
  safeCallerId,
} from "./identity/quotaKey";

/** The usage lane's single bucket, for the same reason. */
export const USAGE_LANE_BUCKET = "lane-shared";

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

/**
 * Claim one hosted scan slot.
 *
 * Takes a callerId and nothing else. No address header, no scan id, and no
 * client-declared string, so there is no argument through which a caller can
 * reach a key with something of their own choosing.
 *
 * Three caps, and all three must pass:
 *   the lane total     unconditional, so a caller holding many ids cannot escape it
 *   the caller's hour  its own bucket when a credential resolved, else the shared one
 *   the caller's day   only when a credential resolved, because a shared bucket
 *                      has no per-caller day to count
 *
 * Order matters. The lane total goes first so the ceiling stops a caller before
 * it walks the per-caller rows, and the hourly cap goes before the daily one so
 * a burst is refused by the tighter bound rather than spending the whole day.
 *
 * Each bump happens only after the previous one passed, so a refused call does
 * not spend a later cap's budget. It does spend the lane total, which is
 * deliberate: that counter exists to measure load, and a refused call was still
 * load.
 */
export const consumeMcpScan = internalMutation({
  args: { callerId: v.optional(v.string()) },
  returns: v.object({ allowed: v.boolean(), reason: v.string() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const hour = new Date(now).toISOString().slice(0, 13);
    const day = hour.slice(0, 10);
    const keys = hostedScanKeys(args.callerId ?? null, now);

    // The lane total, keyed on nothing but the hour. It is written first so the
    // ceiling stops a caller before it walks the per-caller rows, and so no
    // caller identity can escape it.
    const globalOk = await bump(ctx, `mcp-scan-global:${hour}`, day, GLOBAL_LIMIT, now);
    if (!globalOk) return { allowed: false, reason: "global_limit" };

    const hourlyOk = await bump(ctx, keys.hourly, day, hostedHourlyLimit(args.callerId ?? null), now);
    if (!hourlyOk) return { allowed: false, reason: "caller_hourly_limit" };

    if (keys.daily !== null) {
      const dailyOk = await bump(ctx, keys.daily, day, CALLER_DAILY_LIMIT, now);
      if (!dailyOk) return { allowed: false, reason: "caller_daily_limit" };
    }
    return { allowed: true, reason: "allowed" };
  },
});

// Write cap for the usage route. Separate from the scan limits so a noisy usage
// reporter cannot spend the scan quota, and so the cap can be read on its own.
// The route already needs a credential, so the bucket needs no caller value.
export const consumeUsageWrite = internalMutation({
  args: {},
  returns: v.object({ allowed: v.boolean() }),
  handler: async (ctx) => {
    const now = Date.now();
    const hour = new Date(now).toISOString().slice(0, 13);
    const day = hour.slice(0, 10);
    const allowed = await bump(ctx, `mcp-usage:${hour}:${USAGE_LANE_BUCKET}`, day, USAGE_LANE_LIMIT, now);
    return { allowed };
  },
});

// The explain lane spends a provider call per press, so a scan id alone must not
// be able to ask for one over and over. Same table, same bump helper, same hourly
// window as the limits above: a cap per scan, a cap per caller, and a cap on the
// lane as a whole. A caller with no account shares one guest bucket, so holding
// many scan ids buys nothing: the per-scan cap cannot be escaped by changing id.
// The three numbers are a policy choice with no traffic measurement behind them
// (unknown), set high enough that ordinary use never reaches them.
export const EXPLAIN_SCAN_LIMIT = 2;
export const EXPLAIN_CALLER_LIMIT = 12;
// Shared by every visitor with no account, so it is well above one person's cap.
export const EXPLAIN_GUEST_CALLER_LIMIT = 60;
// The whole lane, every scan and every caller together.
export const EXPLAIN_GLOBAL_LIMIT = 200;

/**
 * The bucket a caller spends from. An account id, or the one shared guest bucket.
 * There is no scan id in here on purpose: a key derived from the scan gives a new
 * budget to every new scan id, which is what left a caller with no identity
 * uncapped.
 */
export function explainCallerKey(caller: string | null): string {
  const who = caller === null || caller.length === 0 ? "guest" : `user:${caller}`;
  return who.slice(0, 80);
}

/** The cap that applies to this caller. An identity-less caller shares the guest one. */
export function explainCallerLimit(caller: string | null): number {
  return caller === null || caller.length === 0 ? EXPLAIN_GUEST_CALLER_LIMIT : EXPLAIN_CALLER_LIMIT;
}

/**
 * Claim one explain slot. All three caps must pass, and none is taken from the
 * caller's word for it: a scan id and an account id are all this reads.
 */
export const consumeExplain = internalMutation({
  args: { scanId: v.id("scans"), caller: v.optional(v.string()) },
  returns: v.object({ allowed: v.boolean(), reason: v.string() }),
  handler: async (ctx, args) => {
    const now = Date.now();
    const hour = new Date(now).toISOString().slice(0, 13);
    const day = hour.slice(0, 10);
    // The lane total first, so the ceiling stops a caller that holds many ids
    // before it walks the buckets below.
    const globalOk = await bump(
      ctx,
      `explain-scan-global:${hour}`,
      day,
      EXPLAIN_GLOBAL_LIMIT,
      now,
    );
    if (!globalOk) return { allowed: false, reason: "global_limit" };
    // Per scan next. A scan id is the only credential a guest holds, so this is
    // the cap that has to hold when nothing else is known about the caller.
    const scanOk = await bump(
      ctx,
      `explain:${hour}:scan:${args.scanId}`,
      day,
      EXPLAIN_SCAN_LIMIT,
      now,
    );
    if (!scanOk) return { allowed: false, reason: "scan_limit" };
    const caller = args.caller ?? null;
    const callerOk = await bump(
      ctx,
      `explain:${hour}:caller:${explainCallerKey(caller)}`,
      day,
      explainCallerLimit(caller),
      now,
    );
    if (!callerOk) return { allowed: false, reason: "caller_limit" };
    return { allowed: true, reason: "allowed" };
  },
});

// Closed sets, not a character shape. A shape that allows letters, dots and
// dashes accepts "AdaLovelace", and a version shape with a pre-release suffix
// accepts "1.2-AdaLovelace". These fields are tool and build labels, so each is
// matched against the exact values the installer sends, and anything else is
// normalized to the fallback label. A name is never stored raw.
const ALLOWED_STAGE = new Set(["alpha"]);
const ALLOWED_TIER = new Set(["alpha", "pro"]);
const ALLOWED_HARNESS = new Set([
  "local",
  "cursor",
  "claude_code",
  "claude_desktop",
  "codex",
  "vscode",
  "windsurf",
  "other",
  "unknown",
]);
const ALLOWED_ORDER_SOURCE = new Set(["local", "jev", "perplexity", "table", "unspecified"]);
// A plain version only, and short. A pre-release suffix is a free string, so it is
// refused: "1.2-AdaLovelace" is a name wearing a version's clothes. Each numeric
// part is bounded, so the column is bounded too and a caller cannot mint a new
// dimension with a very long number.
const VERSION_SHAPE = /^\d{1,4}\.\d{1,4}(\.\d{1,4})?$/;

function declaredOr(value: string, allowed: Set<string>, fallback: string): string {
  const trimmed = value.trim();
  return allowed.has(trimmed) ? trimmed : fallback;
}

function declaredVersion(value: string): string {
  const trimmed = value.trim();
  return trimmed === "alpha" || VERSION_SHAPE.test(trimmed) ? trimmed : "other";
}

/**
 * True when a value is one of the labels any of these fields is allowed to keep.
 *
 * Exported for tests. The write path does not use it: it normalizes each field
 * with declaredOr or declaredVersion, because a value valid for one field is not
 * valid for another.
 */
export function isDeclaredValue(value: string): boolean {
  const v = value.trim();
  return (
    ALLOWED_STAGE.has(v) ||
    ALLOWED_TIER.has(v) ||
    ALLOWED_HARNESS.has(v) ||
    ALLOWED_ORDER_SOURCE.has(v) ||
    declaredVersion(v) === v
  );
}

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
  returns: v.boolean(),
  handler: async (ctx, args) => {
    if (args.tier === "enterprise") return false;
    if (args.ruleCounts.length > 4000) return false;
    if (/\/|function |eval\(|-----BEGIN/.test(args.ruleCounts)) return false;
    // Each declared string is normalized to a closed label. A value outside the
    // set becomes "other" (or "unspecified" for the order source), so a name or
    // an address can never land in the row, and the row is still counted.
    const stage = declaredOr(args.stage, ALLOWED_STAGE, "other");
    const tier = declaredOr(args.tier, ALLOWED_TIER, "other");
    const harness = declaredOr(args.harness, ALLOWED_HARNESS, "other");
    const version = declaredVersion(args.version);
    const orderSource = declaredOr(args.orderSource, ALLOWED_ORDER_SOURCE, "unspecified");
    await ctx.db.insert("usageDiagnostics", {
      day: new Date().toISOString().slice(0, 10),
      stage,
      tier,
      harness,
      version,
      durationMs: args.durationMs,
      orderSource,
      ruleCounts: args.ruleCounts,
      createdAt: Date.now(),
    });
    return true;
  },
});
