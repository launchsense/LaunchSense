"use node";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import {
  MAX_STORED_ENTRIES,
  asRecord,
  fetchGitHubJson,
  isRateLimitStatus,
  normalizeTreeEntries,
  type RateLimitInfo,
} from "../adapters/github";
import type { ActionCtx } from "../_generated/server";
import { compareFindings, depOfVuln } from "../../shared/reports/compare.ts";
import { readSessionToken } from "../github/readToken";
import { getAuthUserId } from "@convex-dev/auth/server";
import { checkSnapshot, commitTreeShaOf, treeRequestUrl, treeShaOf } from "./snapshot";
import type { ComparedFinding } from "../../shared/reports/compare.ts";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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

export const rescanScan = action({
  args: { scanId: v.id("scans") },
  returns: v.object({
    scanId: v.id("scans"),
    sameSha: v.boolean(),
    status: v.union(v.literal("completed"), v.literal("partial"), v.literal("failed")),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ scanId: Id<"scans">; sameSha: boolean; status: "completed" | "partial" | "failed" }> => {
    const base = await ctx.runQuery(internal.scans.store.fetchScan, { scanId: args.scanId });
    if (base === null || base.sha === undefined || base.analyzedAt === undefined) {
      throw new Error("Only an analyzed scan can be rescanned.");
    }
    const { owner, repo } = base;
    const token = await readSessionToken(ctx);
    const signedIn = token !== null;
    // The identity is recorded so a signed-in rescan stays readable by its owner
    // under the same ownership rule the report queries use.
    const userId = await getAuthUserId(ctx);

    const meta = await fetchGitHubJson(`https://api.github.com/repos/${owner}/${repo}`, token);
    if (isRateLimitStatus(meta.status, meta.rate)) {
      await rememberGuestQuota(ctx, signedIn, meta.rate);
      throw new Error("GitHub quota is exhausted. Try the rescan after the quota resets.");
    }
    if (meta.status !== 200) throw new Error("Could not reach the repository. Try again.");
    const branch = asRecord(meta.data)?.["default_branch"];
    const defaultBranch = typeof branch === "string" && branch.length > 0 ? branch : "main";

    const commit = await fetchGitHubJson(
      `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(defaultBranch)}`,
      token,
    );
    if (isRateLimitStatus(commit.status, commit.rate)) {
      await rememberGuestQuota(ctx, signedIn, commit.rate);
      throw new Error("GitHub quota is exhausted. Try the rescan after the quota resets.");
    }
    const sha = asRecord(commit.data)?.["sha"];
    if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) {
      throw new Error("GitHub returned an unexpected commit. Try again.");
    }
    // The tree sha this commit promised, from the same response. Free, and it is
    // what turns the tree check below into a comparison rather than a tautology.
    const commitTreeSha = commitTreeShaOf(commit.data);
    if (sha === base.sha) {
      const status =
        base.status === "completed" || base.status === "partial" || base.status === "failed"
          ? base.status
          : "partial";
      return { scanId: args.scanId, sameSha: true, status };
    }

    const now = Date.now();
    // A rescan is a browser action today, so it records the web surface and no
    // credential. Written explicitly rather than omitted so attributed / total
    // covers rescans too.
    const newScanId = await ctx.runMutation(internal.scans.store.createRescan, {
      owner,
      repo,
      repoUrl: base.repoUrl,
      rescanOf: args.scanId,
      signedIn,
      userId: userId ?? undefined,
      attributed: false,
      channel: "web",
      surface: "web",
      now,
    });
    await ctx.runMutation(internal.scans.internal.markFetching, {
      scanId: newScanId,
      now,
      defaultBranch,
    });

    const cached = await ctx.runQuery(internal.scans.internal.findCachedScan, {
      owner,
      repo,
      sha,
      sinceMs: now - CACHE_TTL_MS,
      signedIn,
    });
    if (cached !== null && cached._id !== newScanId) {
      const cachedTree = await ctx.runQuery(internal.scans.internal.getTreeEntries, {
        owner,
        repo,
        sha,
      });
      if (cachedTree !== null) {
        const cachedShas = checkSnapshot({ commitSha: sha, treeSha: cachedTree.treeSha });
        if (!cachedShas.ok) throw new Error("The cached tree did not match the commit. Try again.");
        // Record what the scan stands on before recording how it finished, so the
        // two shas are on the row either way this branch leaves it.
        await ctx.runMutation(internal.scans.internal.markShas, {
          scanId: newScanId,
          commitSha: cachedShas.commitSha,
          treeSha: cachedShas.treeSha,
          now: Date.now(),
        });
        const partial = cachedTree.truncated;
        if (partial) {
          await ctx.runMutation(internal.scans.internal.markPartial, {
            scanId: newScanId,
            sha,
            defaultBranch,
            fileCount: cachedTree.fileCount,
            truncated: true,
            treeTruncated: cachedTree.treeTruncated,
            errorKind: "truncated",
            errorMessage: "Tree is large; unlisted files were not checked.",
            now: Date.now(),
          });
          return { scanId: newScanId, sameSha: false, status: "partial" };
        }
        await ctx.runMutation(internal.scans.internal.markCompleted, {
          scanId: newScanId,
          sha,
          defaultBranch,
          fileCount: cachedTree.fileCount,
          truncated: false,
          treeTruncated: cachedTree.treeTruncated,
          now: Date.now(),
        });
        return { scanId: newScanId, sameSha: false, status: "completed" };
      }
    }

    // The tree URL is built from the pinned commit sha and refuses anything that
    // is not one, so a moving ref cannot reach the request.
    const treeUrl = treeRequestUrl(owner, repo, sha);
    if (treeUrl === null) throw new Error("The commit was not pinned to a single snapshot. Try again.");
    const tree = await fetchGitHubJson(treeUrl, token);
    if (isRateLimitStatus(tree.status, tree.rate)) {
      await rememberGuestQuota(ctx, signedIn, tree.rate);
      await ctx.runMutation(internal.scans.internal.markPartial, {
        scanId: newScanId,
        sha,
        defaultBranch,
        errorKind: "rate_limited",
        errorMessage: "GitHub quota ran out while fetching the new tree.",
        rateLimitResetAt: tree.rate.resetAtMs ?? undefined,
        now: Date.now(),
      });
      return { scanId: newScanId, sameSha: false, status: "partial" };
    }
    if (tree.status !== 200) {
      await ctx.runMutation(internal.scans.internal.markFailed, {
        scanId: newScanId,
        errorKind: "network",
        errorMessage: "Could not fetch the new file tree. Try again.",
        now: Date.now(),
      });
      return { scanId: newScanId, sameSha: false, status: "failed" };
    }
    const { entries, truncated } = normalizeTreeEntries(tree.data);
    const rawCount = Array.isArray(asRecord(tree.data)?.["tree"])
      ? (asRecord(tree.data)?.["tree"] as unknown[]).length
      : entries.length;
    const storedTruncated = truncated || rawCount > MAX_STORED_ENTRIES;
    // Same integrity rule as the fresh scan path: two shas, checked as a pair,
    // and a disagreement fails rather than records.
    const shas = checkSnapshot({ commitSha: sha, treeSha: treeShaOf(tree.data), commitTreeSha });
    if (!shas.ok) {
      throw new Error("The file tree did not match the commit. Nothing was recorded. Try again.");
    }
    await ctx.runMutation(internal.scans.internal.upsertTree, {
      owner,
      repo,
      sha,
      treeSha: shas.treeSha,
      fetchedAt: Date.now(),
      fileCount: rawCount,
      truncated: storedTruncated,
      treeTruncated: truncated,
      entries,
      etag: tree.etag ?? undefined,
    });
    await ctx.runMutation(internal.scans.internal.markShas, {
      scanId: newScanId,
      commitSha: shas.commitSha,
      treeSha: shas.treeSha,
      now: Date.now(),
    });
    if (storedTruncated) {
      await ctx.runMutation(internal.scans.internal.markPartial, {
        scanId: newScanId,
        sha,
        defaultBranch,
        fileCount: rawCount,
        truncated: true,
        treeTruncated: truncated,
        errorKind: "truncated",
        errorMessage: "New tree is large; unlisted files were not checked.",
        now: Date.now(),
      });
      return { scanId: newScanId, sameSha: false, status: "partial" };
    }
    await ctx.runMutation(internal.scans.internal.markCompleted, {
      scanId: newScanId,
      sha,
      defaultBranch,
      fileCount: rawCount,
      truncated: false,
      treeTruncated: truncated,
      now: Date.now(),
    });
    return { scanId: newScanId, sameSha: false, status: "completed" };
  },
});

const stateCounts = v.object({
  fixed: v.number(),
  still_broken: v.number(),
  new: v.number(),
  regressed: v.number(),
  unknown: v.number(),
});

export const compareScans = action({
  args: { fromScanId: v.id("scans"), toScanId: v.id("scans") },
  returns: v.object({
    fromScanId: v.id("scans"),
    toScanId: v.id("scans"),
    sameSha: v.boolean(),
    counts: stateCounts,
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    fromScanId: Id<"scans">;
    toScanId: Id<"scans">;
    sameSha: boolean;
    counts: { fixed: number; still_broken: number; new: number; regressed: number; unknown: number };
  }> => {
    const from = await ctx.runQuery(internal.scans.store.fetchScan, { scanId: args.fromScanId });
    const to = await ctx.runQuery(internal.scans.store.fetchScan, { scanId: args.toScanId });
    if (from === null || to === null || from.sha === undefined || to.sha === undefined) {
      throw new Error("Both scans need a pinned commit before comparing.");
    }
    if (from.owner !== to.owner || from.repo !== to.repo) {
      throw new Error("Only scans of the same repo can be compared.");
    }
    if (from.analyzedAt === undefined || to.analyzedAt === undefined) {
      throw new Error("Both scans need analysis before comparing.");
    }

    const oldRows = await ctx.runQuery(internal.scans.store.listFindings, {
      scanId: args.fromScanId,
    });
    const newRows = await ctx.runQuery(internal.scans.store.listFindings, {
      scanId: args.toScanId,
    });
    const oldList: ComparedFinding[] = oldRows.map((r) => ({
      ruleId: r.ruleId,
      fingerprint: r.fingerprint,
      path: r.path,
      line: r.line,
      severity: r.severity,
      title: r.title,
      why: r.why,
    }));
    const newList: ComparedFinding[] = newRows.map((r) => ({
      ruleId: r.ruleId,
      fingerprint: r.fingerprint,
      path: r.path,
      line: r.line,
      severity: r.severity,
      title: r.title,
      why: r.why,
    }));

    const oldContents = await ctx.runQuery(internal.scans.store.listScanContents, {
      owner: from.owner,
      repo: from.repo,
      sha: from.sha,
    });
    const newContents = await ctx.runQuery(internal.scans.store.listScanContents, {
      owner: to.owner,
      repo: to.repo,
      sha: to.sha,
    });
    const oldFetched = new Set(oldContents.map((c) => c.path));
    for (const row of oldRows) {
      if (row.path === "(repo)") continue;
      oldFetched.add(row.path);
    }
    const newFetched = new Set(newContents.map((c) => c.path));
    for (const row of newRows) {
      if (row.path === "(repo)") continue;
      newFetched.add(row.path);
    }

    const previouslyFixed = new Set<string>();
    if (from.rescanOf !== undefined) {
      const prior = await ctx.runQuery(internal.scans.store.listTransitions, {
        fromScanId: from.rescanOf,
        toScanId: args.fromScanId,
      });
      for (const t of prior) {
        if (t.state === "fixed" && t.oldFingerprint !== undefined) {
          previouslyFixed.add(t.oldFingerprint);
        }
      }
    }

    const transitions = compareFindings(oldList, newList, {
      oldAnalyzer: from.analyzerVersion ?? "unknown",
      newAnalyzer: to.analyzerVersion ?? "unknown",
      oldFetched,
      newFetched,
      oldContents: new Map(oldContents.map((c) => [c.path, c.contentSha])),
      newContents: new Map(newContents.map((c) => [c.path, c.contentSha])),
      previouslyFixed,
      depOf: depOfVuln,
    });

    await ctx.runMutation(internal.scans.store.saveTransitions, {
      fromScanId: args.fromScanId,
      toScanId: args.toScanId,
      now: Date.now(),
      transitions: transitions.map((t) => ({
        oldFingerprint: t.oldFingerprint ?? undefined,
        newFingerprint: t.newFingerprint ?? undefined,
        ruleId: t.ruleId,
        state: t.state,
        cause: t.cause ?? undefined,
      })),
    });

    const counts = { fixed: 0, still_broken: 0, new: 0, regressed: 0, unknown: 0 };
    for (const t of transitions) counts[t.state]++;
    return {
      fromScanId: args.fromScanId,
      toScanId: args.toScanId,
      sameSha: from.sha === to.sha,
      counts,
    };
  },
});
