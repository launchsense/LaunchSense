"use node";

import { action, internalAction } from "../_generated/server";
import type { ActionCtx } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { getAuthUserId } from "@convex-dev/auth/server";
import { parseGitHubRepoUrl } from "../../shared/githubUrl";
import { readSessionToken } from "../github/readToken";
import { ANONYMOUS, attributionFor, type CallerIdentity, type Channel } from "../identity/attribution";
import {
  checkSnapshot,
  commitTreeShaOf,
  treeRequestUrl,
  treeShaOf,
} from "./snapshot";
import {
  MAX_STORED_ENTRIES,
  asRecord,
  fetchGitHubJson,
  isRateLimitStatus,
  normalizeTreeEntries,
  type RateLimitInfo,
} from "../adapters/github";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const INFLIGHT_WINDOW_MS = 2 * 60 * 1000;

/**
 * Read the caller's credential out of the request this action was called from.
 *
 * An action has no `Request` of its own: it runs after the HTTP route has
 * finished. The route resolves the bearer token and passes the result in, which
 * is why `callerId` is a `v.optional(v.string())` validated to the shape of a
 * Convex row id. A client cannot reach this action directly and cannot supply
 * this argument: it is an internal action, and the only caller is the server.
 *
 * Never `Mcp-Session-Id`. A session id is a routing handle the client replays,
 * and MCP servers must not use sessions for authentication.
 */
const callerIdShape = /^[a-z0-9]{20,40}$/i;

function normalizeCallerId(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const trimmed = raw.trim();
  return callerIdShape.test(trimmed) ? trimmed : undefined;
}

/**
 * Where this scan came from, and who asked.
 *
 * `callerId` is passed rather than read, and it is only ever a value a resolve
 * produced. A browser scan has no credential and arrives as ANONYMOUS, which is
 * the honest answer rather than a guess.
 */
function callerOf(args: { callerId?: string; channel: Channel }): CallerIdentity {
  const callerId = normalizeCallerId(args.callerId);
  if (callerId === undefined) return ANONYMOUS;
  return { resolved: true, callerId };
}

const SIGNED_OUT_MISS =
  "This repository did not open. If it is yours, sign in with GitHub and try the same URL again.";
const SIGNED_IN_MISS = "This repository did not open. Sign in with an account that can read it, and try again.";
const CONTENTS_DENIED =
  "GitHub did not allow this read. Turn on Contents: Read for the LaunchSense login, then sign in again.";

async function rememberGuestQuota(ctx: ActionCtx, signedIn: boolean, rate: RateLimitInfo): Promise<void> {
  if (signedIn) return;
  if (rate.remaining === null || rate.limit === null || rate.resetAtMs === null) return;
  await ctx.runMutation(internal.scans.quota.recordQuota, {
    remaining: rate.remaining,
    limit: rate.limit,
    resetAt: rate.resetAtMs,
    now: Date.now(),
  });
}

function rateLimitMessage(resetAtMs: number | null): string {
  if (resetAtMs !== null) {
    const when = new Date(resetAtMs).toLocaleTimeString();
    return `GitHub API quota is exhausted. Try again after ${when}. Showing a partial result with nothing marked as checked.`;
  }
  return "GitHub API quota is exhausted. Try again later. Showing a partial result with nothing marked as checked.";
}

/**
 * The one scan implementation.
 *
 * Both doors call this. `runScan` is the browser door and takes repoUrl and
 * nothing else; `runHostedScan` is the hosted door and adds only identity. There
 * is no second scan pipeline, no second createScan, and no second enforcement
 * point: the surface rule, the sha resolution, and the ownership rule are all
 * below this line and are the same for every caller.
 */
async function performScan(
  ctx: ActionCtx,
  args: { repoUrl: string; callerId?: string; channel: Channel },
): Promise<{ scanId: Id<"scans">; status: "completed" | "partial" | "failed"; cached: boolean }> {
  const parsed = parseGitHubRepoUrl(args.repoUrl);
  if (!parsed.ok) {
    throw new Error(parsed.error);
  }
  const { owner, repo, normalizedUrl } = parsed.value;
  const now = Date.now();
  const token = await readSessionToken(ctx);
  const signedIn = token !== null;
  const userId = await getAuthUserId(ctx);
  // The identity the hosted route resolved, folded into the scan row. A browser
  // call has no credential, so it arrives anonymous and is recorded as such.
  const identity = callerOf(args);
  const attribution = attributionFor(identity, args.channel);

  const inFlight = await ctx.runQuery(internal.scans.internal.findInFlight, {
    owner,
    repo,
    sinceMs: now - INFLIGHT_WINDOW_MS,
    signedIn,
    callerId: attribution.callerId,
  });
  // A row that belongs to somebody else is never handed back. The caller mints
  // its own row below and the sha-keyed cache copies the tree into it, so the
  // work is not repeated and the ownership claim stays true.
  //
  // Only reuse an in-flight row once it has a commit pinned, otherwise the
  // caller would get a scan that cannot be analyzed yet.
  if (inFlight !== null && inFlight.owned && inFlight.scan.sha !== undefined) {
    const status = inFlight.scan.status === "completed" || inFlight.scan.status === "partial" ? inFlight.scan.status : "partial";
    return { scanId: inFlight.scan._id, status, cached: true };
  }

  const scanId = await ctx.runMutation(internal.scans.internal.createScan, {
    owner,
    repo,
    repoUrl: normalizedUrl,
    signedIn,
    userId: userId ?? undefined,
    attributedCallerId: attribution.callerId as Id<"credentials"> | undefined,
    attributed: attribution.attributed,
    channel: attribution.channel,
    surface: attribution.surface,
    now,
  });
  await ctx.runMutation(internal.scans.internal.markFetching, { scanId, now });

  let defaultBranch = "main";
  try {
    const meta = await fetchGitHubJson(`https://api.github.com/repos/${owner}/${repo}`, token);
    if (isRateLimitStatus(meta.status, meta.rate)) {
      const resetAt = meta.rate.resetAtMs ?? (meta.rate.retryAfterMs !== null ? Date.now() + meta.rate.retryAfterMs : null);
      await rememberGuestQuota(ctx, signedIn, meta.rate);
      const message = rateLimitMessage(resetAt);
      await ctx.runMutation(internal.scans.internal.markPartial, {
        scanId,
        errorKind: "rate_limited",
        errorMessage: message,
        rateLimitResetAt: resetAt ?? undefined,
        now: Date.now(),
      });
      return { scanId, status: "partial", cached: false };
    }
    if (meta.status === 404) {
      await ctx.runMutation(internal.scans.internal.markFailed, {
        scanId,
        errorKind: "not_found",
        errorMessage: signedIn ? SIGNED_IN_MISS : SIGNED_OUT_MISS,
        now: Date.now(),
      });
      return { scanId, status: "failed", cached: false };
    }
    if ((meta.status === 401 || meta.status === 403) && !isRateLimitStatus(meta.status, meta.rate)) {
      await ctx.runMutation(internal.scans.internal.markFailed, {
        scanId,
        errorKind: "unknown",
        errorMessage: CONTENTS_DENIED,
        now: Date.now(),
      });
      return { scanId, status: "failed", cached: false };
    }
    if (meta.status !== 200) {
      await ctx.runMutation(internal.scans.internal.markFailed, {
        scanId,
        errorKind: "network",
        errorMessage: `GitHub metadata request failed (HTTP ${meta.status}). Try again.`,
        now: Date.now(),
      });
      return { scanId, status: "failed", cached: false };
    }
    await rememberGuestQuota(ctx, signedIn, meta.rate);
    const metaRecord = asRecord(meta.data);
    const branch = metaRecord?.["default_branch"];
    if (typeof branch === "string" && branch.length > 0) defaultBranch = branch;
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError"
      ? "GitHub did not respond in time. Try again."
      : "Could not reach GitHub. Try again.";
    await ctx.runMutation(internal.scans.internal.markFailed, {
      scanId,
      errorKind: "network",
      errorMessage: message,
      now: Date.now(),
    });
    return { scanId, status: "failed", cached: false };
  }

  let sha: string;
  let commitTreeSha: string | undefined;
  try {
    const commit = await fetchGitHubJson(
      `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(defaultBranch)}`,
      token,
    );
    if (isRateLimitStatus(commit.status, commit.rate)) {
      const resetAt = commit.rate.resetAtMs ?? null;
      await rememberGuestQuota(ctx, signedIn, commit.rate);
      await ctx.runMutation(internal.scans.internal.markPartial, {
        scanId,
        defaultBranch,
        errorKind: "rate_limited",
        errorMessage: rateLimitMessage(resetAt),
        rateLimitResetAt: resetAt ?? undefined,
        now: Date.now(),
      });
      return { scanId, status: "partial", cached: false };
    }
    if (commit.status !== 200) {
      await ctx.runMutation(internal.scans.internal.markFailed, {
        scanId,
        errorKind: commit.status === 404 ? "not_found" : "network",
        errorMessage:
          commit.status === 404
            ? "Default branch was not found. The repository may be empty."
            : `GitHub commit request failed (HTTP ${commit.status}). Try again.`,
        now: Date.now(),
      });
      return { scanId, status: "failed", cached: false };
    }
    // Resolution rule. The branch name is resolved to a full commit sha here
    // and the sha is what every downstream call uses. A branch name that came
    // back as anything other than 40 hex characters is refused, so a moving ref
    // can never become a scan.
    const commitRecord = asRecord(commit.data);
    const foundSha = commitRecord?.["sha"];
    if (typeof foundSha !== "string" || !/^[0-9a-f]{40}$/.test(foundSha)) {
      await ctx.runMutation(internal.scans.internal.markFailed, {
        scanId,
        errorKind: "unknown",
        errorMessage: "GitHub returned an unexpected commit response. Try again.",
        now: Date.now(),
      });
      return { scanId, status: "failed", cached: false };
    }
    sha = foundSha;
    // The tree sha this commit promised, carried out of the same response. It
    // costs no extra request and it is what makes the tree integrity check a
    // real check rather than a self-comparison.
    commitTreeSha = commitTreeShaOf(commit.data);
  } catch {
    await ctx.runMutation(internal.scans.internal.markFailed, {
      scanId,
      errorKind: "network",
      errorMessage: "Could not resolve the latest commit. Try again.",
      now: Date.now(),
    });
    return { scanId, status: "failed", cached: false };
  }

  const cached = await ctx.runQuery(internal.scans.internal.findCachedScan, {
    owner,
    repo,
    sha,
    sinceMs: Date.now() - CACHE_TTL_MS,
    signedIn,
  });
  if (cached !== null && cached._id !== scanId) {
    const cachedTree = await ctx.runQuery(internal.scans.internal.getTreeEntries, { owner, repo, sha });
    if (cachedTree !== null) {
      // The cached row carries the tree sha it was fetched at, so a scan built
      // from the cache records the same two fields as one built from a fresh
      // tree. Both are written from the pinned commit sha, never from a ref.
      const cachedShas = checkSnapshot({ commitSha: sha, treeSha: cachedTree.treeSha });
      if (!cachedShas.ok) {
        await ctx.runMutation(internal.scans.internal.markFailed, {
          scanId,
          errorKind: "unknown",
          errorMessage: "The cached tree did not match the commit. Run the scan again.",
          now: Date.now(),
        });
        return { scanId, status: "failed", cached: false };
      }
      // Record what the scan stands on before recording how it finished, so the
      // two shas are on the row whichever status branch below leaves it.
      await ctx.runMutation(internal.scans.internal.markShas, {
        scanId,
        commitSha: cachedShas.commitSha,
        treeSha: cachedShas.treeSha,
        now: Date.now(),
      });
      await ctx.runMutation(internal.scans.internal.markCompleted, {
        scanId,
        sha,
        defaultBranch,
        fileCount: cachedTree.fileCount,
        truncated: cachedTree.truncated,
        treeTruncated: cachedTree.treeTruncated,
        now: Date.now(),
      });
      const finalStatus = cachedTree.truncated ? "partial" : "completed";
      if (finalStatus === "partial") {
        await ctx.runMutation(internal.scans.internal.markPartial, {
          scanId,
          sha,
          defaultBranch,
          fileCount: cachedTree.fileCount,
          truncated: true,
          treeTruncated: cachedTree.treeTruncated,
          errorKind: "truncated",
          errorMessage: `Tree is large; showing ${cachedTree.entryCountStored} of ${cachedTree.fileCount} paths. Unlisted files were not checked.`,
          now: Date.now(),
        });
      }
      return { scanId, status: finalStatus, cached: true };
    }
  }

  // Integrity rule, enforced here rather than in a comment. The tree URL is
  // built from the pinned commit sha and refuses anything that is not one, so a
  // moving ref cannot reach the request. The response's own sha is then checked
  // against the tree sha the commit response promised, and a disagreement fails
  // the scan instead of storing a snapshot neither response supports.
  const treeUrl = treeRequestUrl(owner, repo, sha);
  if (treeUrl === null) {
    await ctx.runMutation(internal.scans.internal.markFailed, {
      scanId,
      errorKind: "unknown",
      errorMessage: "The commit was not pinned to a single snapshot. Try again.",
      now: Date.now(),
    });
    return { scanId, status: "failed", cached: false };
  }
  try {
    const tree = await fetchGitHubJson(treeUrl, token);
    if (isRateLimitStatus(tree.status, tree.rate)) {
      const resetAt = tree.rate.resetAtMs ?? null;
      await rememberGuestQuota(ctx, signedIn, tree.rate);
      await ctx.runMutation(internal.scans.internal.markPartial, {
        scanId,
        sha,
        defaultBranch,
        errorKind: "rate_limited",
        errorMessage: rateLimitMessage(resetAt),
        rateLimitResetAt: resetAt ?? undefined,
        now: Date.now(),
      });
      return { scanId, status: "partial", cached: false };
    }
    if (tree.status !== 200) {
      await ctx.runMutation(internal.scans.internal.markFailed, {
        scanId,
        errorKind: tree.status === 404 ? "not_found" : "network",
        errorMessage:
          tree.status === 404
            ? "Commit tree was not found. Try scanning again."
            : `GitHub tree request failed (HTTP ${tree.status}). Try again.`,
        now: Date.now(),
      });
      return { scanId, status: "failed", cached: false };
    }
    const { entries, truncated } = normalizeTreeEntries(tree.data);
    const treeRecord = asRecord(tree.data);
    const rawCount = Array.isArray(treeRecord?.["tree"])
      ? (treeRecord?.["tree"] as unknown[]).length
      : entries.length;
    const fileCount = rawCount;
    const storedTruncated = truncated || rawCount > MAX_STORED_ENTRIES;

    // The two shas are checked before anything is stored. commitSha is what
    // the scan describes, treeSha is the tree object the response carried, and
    // the check is that they are the pair the commit promised.
    const shas = checkSnapshot({ commitSha: sha, treeSha: treeShaOf(tree.data), commitTreeSha });
    if (!shas.ok) {
      await ctx.runMutation(internal.scans.internal.markFailed, {
        scanId,
        errorKind: "unknown",
        errorMessage:
          shas.defect === "tree_sha_mismatch"
            ? "The file tree did not match the commit. Nothing was recorded. Try again."
            : "GitHub returned an unexpected tree response. Try again.",
        now: Date.now(),
      });
      return { scanId, status: "failed", cached: false };
    }

    await ctx.runMutation(internal.scans.internal.upsertTree, {
      owner,
      repo,
      sha,
      treeSha: shas.treeSha,
      fetchedAt: Date.now(),
      fileCount,
      truncated: storedTruncated,
      treeTruncated: truncated,
      entries,
      etag: tree.etag ?? undefined,
    });
    await ctx.runMutation(internal.scans.internal.markShas, {
      scanId,
      commitSha: shas.commitSha,
      treeSha: shas.treeSha,
      now: Date.now(),
    });

    if (storedTruncated) {
      await ctx.runMutation(internal.scans.internal.markPartial, {
        scanId,
        sha,
        defaultBranch,
        fileCount,
        truncated: true,
        treeTruncated: truncated,
        errorKind: "truncated",
        errorMessage: `Tree is large; showing ${entries.length} of ${fileCount} paths. Unlisted files were not checked.`,
        now: Date.now(),
      });
      return { scanId, status: "partial", cached: false };
    }

    await ctx.runMutation(internal.scans.internal.markCompleted, {
      scanId,
      sha,
      defaultBranch,
      fileCount,
      truncated: false,
      treeTruncated: truncated,
      now: Date.now(),
    });
    return { scanId, status: "completed", cached: false };
  } catch {
    await ctx.runMutation(internal.scans.internal.markFailed, {
      scanId,
      errorKind: "network",
      errorMessage: "Could not fetch the file tree. Try again.",
      now: Date.now(),
    });
    return { scanId, status: "failed", cached: false };
  }
}

/**
 * The browser door.
 *
 * `repoUrl` and nothing else, and that is the surface rule rather than an
 * oversight: there is no ref, sha, branch, or path parameter on this action, so
 * a caller cannot ask for a commit. It also cannot name a caller, because a
 * browser has no credential and the action writes attributed:false.
 */
export const runScan = action({
  args: { repoUrl: v.string() },
  returns: v.object({
    scanId: v.id("scans"),
    status: v.union(
      v.literal("completed"),
      v.literal("partial"),
      v.literal("failed"),
    ),
    cached: v.boolean(),
  }),
  handler: async (ctx, args): Promise<{ scanId: Id<"scans">; status: "completed" | "partial" | "failed"; cached: boolean }> =>
    await performScan(ctx, { repoUrl: args.repoUrl, channel: "web" }),
});

/**
 * The hosted door.
 *
 * Internal, so no client can reach it: the only caller is an httpAction that
 * already resolved a bearer token. `callerId` is the value that resolve
 * returned, and it is validated to the shape of a Convex row id before it is
 * used, so a malformed one falls to the shared anonymous bucket rather than
 * minting a bucket of its own.
 *
 * No ref, sha, branch, or path here either. Identity is not a way to choose code.
 */
export const runHostedScan = internalAction({
  args: {
    repoUrl: v.string(),
    callerId: v.optional(v.string()),
    channel: v.union(v.literal("mcp"), v.literal("api")),
  },
  returns: v.object({
    scanId: v.id("scans"),
    status: v.union(
      v.literal("completed"),
      v.literal("partial"),
      v.literal("failed"),
    ),
    cached: v.boolean(),
  }),
  handler: async (ctx, args): Promise<{ scanId: Id<"scans">; status: "completed" | "partial" | "failed"; cached: boolean }> =>
    await performScan(ctx, {
      repoUrl: args.repoUrl,
      callerId: normalizeCallerId(args.callerId),
      channel: args.channel,
    }),
});
