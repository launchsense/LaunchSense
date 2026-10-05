// Which bucket a hosted scan call spends from.
//
// Extracted from convex/mcpLimit.ts on purpose. This file has no Convex import,
// so the rule that decides a key can be driven by a test directly rather than
// inferred from a stored string. The mutation that bumps the counters lives in
// mcpLimit.ts and calls in here.
//
// The rule, in one line: the key is the server-minted callerId, or the one
// shared bucket when no credential resolved. Never a client-supplied string.
//
// A client-supplied string is the defect this lane exists to remove. The hosted
// routes used to key on `x-forwarded-for`, which is attacker-controlled: rotate
// one header and you mint a fresh budget, while every builder behind a single
// office egress shares one. Neither of those is a rate limit.
//
// Two numbers exist because a per-hour cap alone permits 48 scans a day, and
// every one of those is a recursive tree walk plus up to 200 blob fetches
// against the GitHub budget that quotaState mirrors. The per-day cap is the one
// that bounds that. Both are a policy choice with no traffic measurement behind
// them (unknown); a per-caller baseline has not been measured, so treat them as
// numbers to revisit once hosted traffic exists, not as a measured limit.

/** The bucket every identity-less caller spends from. Deliberately not an address. */
export const HOSTED_CALLER_BUCKET = "hosted-shared";

/**
 * Per-caller cap for one hour. Above one builder's realistic hourly use and
 * below the old two-an-hour value that shared an office egress with everyone.
 */
export const CALLER_HOURLY_LIMIT = 20;

/**
 * Per-caller cap for one day. Roughly a working day's worth for one harness at
 * the hourly cap, so the hourly cap binds first during a burst and this one
 * binds across a day. Unknown until measured.
 */
export const CALLER_DAILY_LIMIT = 120;

/** The shared-bucket hourly cap. Kept equal to CALLER_LIMIT in mcpLimit.ts, which
 * is the constant the public documents quote; a test asserts the two agree. */
export const SHARED_HOURLY_LIMIT = 200;

/**
 * A callerId is a Convex row id, which is a fixed alphabet. Anything else is not
 * a server-minted id and must not become a key.
 *
 * This is the check that makes "never key on a client-supplied string" true in
 * code rather than by convention. A callerId reaches this module from a resolve
 * that read it out of the database, so a value here is either a row id the
 * server issued or it is refused, and an unresolvable caller falls to the shared
 * bucket instead of minting a bucket of its own.
 */
const CALLER_ID_SHAPE = /^[a-z0-9]{20,40}$/i;

/** A callerId this module is willing to put in a key, or null. */
export function safeCallerId(callerId: string | null | undefined): string | null {
  if (typeof callerId !== "string") return null;
  const trimmed = callerId.trim();
  if (!CALLER_ID_SHAPE.test(trimmed)) return null;
  return trimmed;
}

/**
 * The bucket a caller spends from: its own, or the shared one.
 *
 * An identity-less caller shares one bucket, which is the honest shape while
 * hosted identity is new. The cost is that one noisy anonymous caller can spend
 * the group's budget, and the cap is set for a group rather than one person
 * because of it.
 */
export function hostedCallerBucket(callerId: string | null | undefined): string {
  const safe = safeCallerId(callerId);
  return safe === null ? HOSTED_CALLER_BUCKET : `caller:${safe}`;
}

/** The cap that applies to this bucket. The shared bucket is the group number. */
export function hostedHourlyLimit(callerId: string | null | undefined): number {
  return safeCallerId(callerId) === null ? SHARED_HOURLY_LIMIT : CALLER_HOURLY_LIMIT;
}

/**
 * The caller keys one hosted scan call writes.
 *
 * The lane total is not here. It is unconditional and it is a lane concern, so it
 * lives in mcpLimit.ts next to the constant that bounds it. Only the keys that
 * depend on identity are here, which is the whole reason this module exists.
 *
 * hourly is always written, for the shared bucket or for the caller's own.
 * daily is written only for a resolved caller, because a shared bucket has no
 * per-caller day to count and a row meaning nothing would be a row nobody can
 * interpret later.
 */
export function hostedScanKeys(
  callerId: string | null | undefined,
  now: number,
): { hourly: string; daily: string | null; callerBucket: string } {
  const stamp = new Date(now).toISOString();
  const hour = stamp.slice(0, 13);
  const day = stamp.slice(0, 10);
  const callerBucket = hostedCallerBucket(callerId);
  return {
    hourly: `mcp-scan:${hour}:${callerBucket}`,
    // A Convex row id is 32 characters; anything else did not come from a resolve.
    daily: safeCallerId(callerId) === null ? null : `mcp-scan-day:${day}:${callerBucket}`,
    callerBucket,
  };
}