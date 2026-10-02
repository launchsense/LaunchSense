"use node";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { parseGitHubRepoUrl } from "../../shared/githubUrl";
import {
  MAX_STORED_ENTRIES,
  asRecord,
  fetchGitHubJson,
  isRateLimitStatus,
  normalizeTreeEntries,
} from "../adapters/github";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const INFLIGHT_WINDOW_MS = 2 * 60 * 1000;

function rateLimitMessage(resetAtMs: number | null): string {
  if (resetAtMs !== null) {
    const when = new Date(resetAtMs).toLocaleTimeString();
    return `GitHub API quota is exhausted. Try again after ${when}. Showing a partial result with nothing marked as checked.`;
  }
  return "GitHub API quota is exhausted. Try again later. Showing a partial result with nothing marked as checked.";
}

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
  handler: async (ctx, args): Promise<{ scanId: Id<"scans">; status: "completed" | "partial" | "failed"; cached: boolean }> => {
    const parsed = parseGitHubRepoUrl(args.repoUrl);
    if (!parsed.ok) {
      throw new Error(parsed.error);
    }
    const { owner, repo, normalizedUrl } = parsed.value;
    const now = Date.now();

    const inFlight = await ctx.runQuery(internal.scans.internal.findInFlight, {
      owner,
      repo,
      sinceMs: now - INFLIGHT_WINDOW_MS,
    });
    if (inFlight !== null) {
      const status = inFlight.status === "completed" || inFlight.status === "partial" ? inFlight.status : "partial";
      return { scanId: inFlight._id, status, cached: true };
    }

    const scanId = await ctx.runMutation(internal.scans.internal.createScan, {
      owner,
      repo,
      repoUrl: normalizedUrl,
      now,
    });
    await ctx.runMutation(internal.scans.internal.markFetching, { scanId, now });

    let defaultBranch = "main";
    try {
      const meta = await fetchGitHubJson(`https://api.github.com/repos/${owner}/${repo}`);
      if (isRateLimitStatus(meta.status, meta.rate)) {
        const resetAt = meta.rate.resetAtMs ?? meta.rate.retryAfterMs !== null ? (meta.rate.resetAtMs ?? Date.now() + (meta.rate.retryAfterMs ?? 0)) : null;
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
          errorMessage: "Repository was not found. It may be private, renamed, or deleted.",
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
    try {
      const commit = await fetchGitHubJson(
        `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(defaultBranch)}`,
      );
      if (isRateLimitStatus(commit.status, commit.rate)) {
        const resetAt = commit.rate.resetAtMs ?? null;
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
    });
    if (cached !== null && cached._id !== scanId) {
      const cachedTree = await ctx.runQuery(internal.scans.internal.getTreeEntries, { owner, repo, sha });
      if (cachedTree !== null) {
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

    try {
      const tree = await fetchGitHubJson(
        `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
      );
      if (isRateLimitStatus(tree.status, tree.rate)) {
        const resetAt = tree.rate.resetAtMs ?? null;
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

      await ctx.runMutation(internal.scans.internal.upsertTree, {
        owner,
        repo,
        sha,
        fetchedAt: Date.now(),
        fileCount,
        truncated: storedTruncated,
        treeTruncated: truncated,
        entries,
        etag: tree.etag ?? undefined,
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
  },
});
