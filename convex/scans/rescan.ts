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
} from "../adapters/github";
import { compareFindings, depOfVuln } from "../../shared/reports/compare.ts";
import type { ComparedFinding } from "../../shared/reports/compare.ts";

const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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

    const meta = await fetchGitHubJson(`https://api.github.com/repos/${owner}/${repo}`);
    if (isRateLimitStatus(meta.status, meta.rate)) {
      throw new Error("GitHub quota is exhausted. Try the rescan after the quota resets.");
    }
    if (meta.status !== 200) throw new Error("Could not reach the repository. Try again.");
    const branch = asRecord(meta.data)?.["default_branch"];
    const defaultBranch = typeof branch === "string" && branch.length > 0 ? branch : "main";

    const commit = await fetchGitHubJson(
      `https://api.github.com/repos/${owner}/${repo}/commits/${encodeURIComponent(defaultBranch)}`,
    );
    if (isRateLimitStatus(commit.status, commit.rate)) {
      throw new Error("GitHub quota is exhausted. Try the rescan after the quota resets.");
    }
    const sha = asRecord(commit.data)?.["sha"];
    if (typeof sha !== "string" || !/^[0-9a-f]{40}$/.test(sha)) {
      throw new Error("GitHub returned an unexpected commit. Try again.");
    }
    if (sha === base.sha) {
      const status =
        base.status === "completed" || base.status === "partial" || base.status === "failed"
          ? base.status
          : "partial";
      return { scanId: args.scanId, sameSha: true, status };
    }

    const now = Date.now();
    const newScanId = await ctx.runMutation(internal.scans.store.createRescan, {
      owner,
      repo,
      repoUrl: base.repoUrl,
      rescanOf: args.scanId,
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
    });
    if (cached !== null && cached._id !== newScanId) {
      const cachedTree = await ctx.runQuery(internal.scans.internal.getTreeEntries, {
        owner,
        repo,
        sha,
      });
      if (cachedTree !== null) {
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

    const tree = await fetchGitHubJson(
      `https://api.github.com/repos/${owner}/${repo}/git/trees/${sha}?recursive=1`,
    );
    if (isRateLimitStatus(tree.status, tree.rate)) {
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
    await ctx.runMutation(internal.scans.internal.upsertTree, {
      owner,
      repo,
      sha,
      fetchedAt: Date.now(),
      fileCount: rawCount,
      truncated: storedTruncated,
      treeTruncated: truncated,
      entries,
      etag: tree.etag ?? undefined,
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
