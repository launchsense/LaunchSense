"use node";

import { action } from "../_generated/server";
import { internal } from "../_generated/api";
import type { Id } from "../_generated/dataModel";
import { v } from "convex/values";
import { ANALYZER_VERSION } from "../../shared/analyzers/version";
import { scanSecrets } from "../../shared/analyzers/secrets";
import { analyzeHygiene } from "../../shared/analyzers/hygiene";
import { parseManifests } from "../../shared/analyzers/deps";
import { analyzeLicenses } from "../../shared/analyzers/licenses";
import { severityFor } from "../../shared/policies/severity";
import type { Severity } from "../../shared/policies/severity";
import {
  fingerprintFinding,
  fnv1aHex,
  redactedSnippet,
} from "../../shared/redaction";
import { fetchBlobContent } from "../adapters/github";
import { fetchRepoTarball } from "../adapters/tarball";
import { queryOsvBatch } from "../adapters/osv";

const MAX_FILES_FETCHED = 200;
const MAX_TOTAL_BYTES = 2000000;
// Convex actions time out at 10 minutes. Stop well before that so a slow
// upstream produces an honest partial result instead of a dropped action.
const ANALYZE_DEADLINE_MS = 150000;
const CONTENT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const OSV_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff",
  "mp4", "mp3", "wav", "avi", "mov",
  "zip", "gz", "tar", "pdf",
  "woff", "woff2", "ttf", "otf", "eot",
  "exe", "dll", "so", "dylib", "class", "pyc",
  "sqlite", "db", "lock",
]);

const SKIP_DIRS = [
  "node_modules/",
  "dist/",
  "build/",
  ".git/",
  "coverage/",
  ".next/",
  "vendor/",
  "target/",
  "__pycache__/",
];

const OSV_ECOSYSTEMS: Record<string, string> = {
  npm: "npm",
  PyPI: "PyPI",
  Go: "Go",
};

interface EvidenceItem {
  ruleId: string;
  path: string;
  line: number;
  contentHash: string;
  redactedSnippet: string;
  severity: Severity;
}

interface FindingItem extends EvidenceItem {
  fingerprint: string;
  title: string;
  why: string;
  bucket: "actionable" | "info";
}

const SECRET_TEXT: Record<string, { title: string; why: string }> = {
  "secret.tracked-env": {
    title: "Environment file is tracked in git",
    why: "Anyone with repo access can read everything in a tracked env file.",
  },
  "secret.private-key": {
    title: "Private key material in a tracked file",
    why: "A committed private key must be treated as public from that moment on.",
  },
  "secret.github-token": {
    title: "GitHub token in a tracked file",
    why: "Tokens in tracked files can be used by anyone who can read the repo.",
  },
  "secret.aws-key": {
    title: "Cloud access key in a tracked file",
    why: "Committed cloud keys are harvested by automated scanners within minutes.",
  },
  "secret.credential-pattern": {
    title: "Hardcoded credential in source",
    why: "Passwords and API keys in source travel everywhere the code goes.",
  },
  "secret.client-exposure": {
    title: "Secret shipped in a public file",
    why: "Anything in public files or pages is visible to every visitor.",
  },
  "secret.eval-use": {
    title: "Eval runs strings as code",
    why: "Eval turns small injection flaws into full control of the page or server.",
  },
  "secret.debugger-statement": {
    title: "Debugger statement left in code",
    why: "A debugger statement freezes the app for anyone who opens it.",
  },
  "secret.debug-leftover": {
    title: "Debug output left in source",
    why: "Console noise leaks internals and looks unfinished to anyone reviewing.",
  },
  "secret.sql-pattern": {
    title: "Possible string-built database query",
    why: "String-built queries let crafted input run database commands.",
  },
};

function skipReason(path: string): string | null {
  for (const dir of SKIP_DIRS) {
    if (path.startsWith(dir)) return "generated/dependency directory";
  }
  const base = path.split("/").pop() ?? path;
  const dot = base.lastIndexOf(".");
  if (dot > 0) {
    const ext = base.slice(dot + 1).toLowerCase();
    if (BINARY_EXTENSIONS.has(ext)) return "binary or media file";
  }
  return null;
}

function manifestLine(content: string, name: string): number {
  const lines = content.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if ((lines[i] ?? "").includes(name)) return i + 1;
  }
  return 1;
}

function pushEvidence(
  evidence: EvidenceItem[],
  findings: FindingItem[],
  item: Omit<FindingItem, "fingerprint" | "contentHash" | "redactedSnippet"> & {
    rawSnippet: string;
  },
): void {
  const snippet = redactedSnippet(item.rawSnippet);
  const fingerprint = fingerprintFinding(item.ruleId, ANALYZER_VERSION, item.path, snippet);
  const full: FindingItem = {
    ruleId: item.ruleId,
    path: item.path,
    line: item.line,
    severity: item.severity,
    title: item.title,
    why: item.why,
    bucket: item.bucket,
    fingerprint,
    contentHash: fnv1aHex(snippet),
    redactedSnippet: snippet,
  };
  evidence.push(full);
  findings.push(full);
}

export const analyzeScan = action({
  args: { scanId: v.id("scans") },
  returns: v.object({
    scanId: v.id("scans"),
    status: v.union(
      v.literal("completed"),
      v.literal("partial"),
      v.literal("failed"),
      v.literal("queued"),
    ),
    findingCount: v.number(),
    evidenceCount: v.number(),
    fetched: v.number(),
    skipped: v.number(),
    queuePosition: v.optional(v.number()),
    queueRunning: v.optional(v.number()),
    queueLimit: v.optional(v.number()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    scanId: Id<"scans">;
    status: "completed" | "partial" | "failed" | "queued";
    findingCount: number;
    evidenceCount: number;
    fetched: number;
    skipped: number;
    queuePosition?: number;
    queueRunning?: number;
    queueLimit?: number;
  }> => {
    const scan = await ctx.runQuery(internal.scans.store.fetchScan, { scanId: args.scanId });
    if (scan === null || scan.sha === undefined) {
      throw new Error("Scan is not ready for analysis yet. Fetch the tree first.");
    }
    const { owner, repo, sha } = scan;

    // Admission control. Sprint day brings many visitors at once, so a scan
    // either gets one of the few analysis slots or is told its place and told
    // to come back. It is better to queue honestly than to let every scan fail
    // on quota at the same moment.
    const slot = await ctx.runMutation(internal.scans.quota.claimSlot, {
      scanId: args.scanId,
      owner,
      repo,
      now: Date.now(),
    });
    if (slot.position > 0) {
      await ctx.runMutation(internal.scans.internal.markProgress, {
        scanId: args.scanId,
        fetchedFileCount: 0,
        totalPlanned: 0,
        phase: `queued:${slot.position}`,
        now: Date.now(),
      });
      return {
        scanId: args.scanId,
        status: "queued",
        findingCount: 0,
        evidenceCount: 0,
        fetched: 0,
        skipped: 0,
        queuePosition: slot.position,
        queueRunning: slot.running,
        queueLimit: slot.limit,
      };
    }

    // Enforce the cache window by deleting, not just by ignoring on read.
    await ctx.runMutation(internal.scans.store.purgeStaleContents, {
      owner,
      repo,
      beforeMs: Date.now() - CONTENT_CACHE_TTL_MS,
    });
    const tree = await ctx.runQuery(internal.scans.internal.getTreeEntries, { owner, repo, sha });
    if (tree === null) {
      throw new Error("File tree is missing. Fetch the tree first.");
    }

    const blobs = tree.entries.filter((e) => e.type === "blob").map((e) => e.path);
    const candidates: string[] = [];
    const skipped: Array<{ path: string; reason: string }> = [];
    for (const path of blobs) {
      const reason = skipReason(path);
      if (reason !== null) {
        skipped.push({ path, reason });
        continue;
      }
      candidates.push(path);
    }
    const priority = (p: string): number => {
      const base = p.split("/").pop() ?? p;
      if (base === "package.json" || base === "requirements.txt" || base === "go.mod" || base === "Cargo.toml") return 0;
      if (base === "LICENSE" || base.startsWith("LICENSE.") || base === ".env" || base.startsWith(".env.")) return 1;
      if (p.startsWith("src/") || p.startsWith("convex/")) return 2;
      return 3;
    };
    candidates.sort((a, b) => priority(a) - priority(b) || (a < b ? -1 : 1));
    const selected = candidates.slice(0, MAX_FILES_FETCHED);
    for (const path of candidates.slice(MAX_FILES_FETCHED)) {
      skipped.push({ path, reason: "file cap (200 files)" });
    }

    // One tarball request replaces up to 200 per-file content requests. This is
    // the difference between a scan that fits an unauthenticated GitHub quota
    // and one that exhausts it on the first visitor.
    const deadline = Date.now() + ANALYZE_DEADLINE_MS;
    const tarball = await fetchRepoTarball(owner, repo, sha);
    if (tarball.quota !== null) {
      await ctx.runMutation(internal.scans.quota.recordQuota, {
        remaining: tarball.quota.remaining,
        limit: tarball.quota.limit,
        resetAt: tarball.quota.resetAt,
        now: Date.now(),
      });
    }
    const files: Array<{ path: string; content: string; size: number }> = [];
    let bytesUsed = 0;
    let rateLimitedAt: number | null = null;
    let processed = 0;

    if (tarball.status === "ok") {
      for (const entry of tarball.entries) {
        if (Date.now() > deadline) break;
        if (files.length >= MAX_FILES_FETCHED || bytesUsed >= MAX_TOTAL_BYTES) break;
        files.push({ path: entry.path, content: entry.content, size: entry.size });
        bytesUsed += entry.size;
        processed += 1;
        await ctx.runMutation(internal.scans.store.saveContent, {
          owner,
          repo,
          sha,
          path: entry.path,
          contentSha: "",
          size: entry.size,
          truncated: false,
          fetchedAt: Date.now(),
        });
      }
      if (tarball.truncated) {
        for (const path of candidates) {
          if (!files.some((f) => f.path === path) && !skipped.some((s) => s.path === path)) {
            skipped.push({ path, reason: "file cap (200 files) or byte budget (2MB)" });
          }
        }
      }
    } else if (tarball.status === "too-large") {
      for (const path of candidates) {
        skipped.push({ path, reason: "repo tarball over 20MB" });
      }
    } else {
      for (const path of candidates) {
        skipped.push({ path, reason: "tarball fetch failed" });
      }
    }

    await ctx.runMutation(internal.scans.internal.markProgress, {
      scanId: args.scanId,
      fetchedFileCount: processed,
      totalPlanned: candidates.length,
      now: Date.now(),
    });

    // Fallback path only. The tarball above normally covers everything in one
    // request. If it failed, fall back to per-file fetches for the files the
    // tarball did not deliver, at concurrency 8 so a fallback cannot itself
    // exhaust the quota.
    const missing = selected.filter(
      (path) => !files.some((f) => f.path === path) && !skipped.some((s) => s.path === path),
    );
    const FALLBACK_CONCURRENCY = 8;
    let nextIndex = 0;
    let stopped = false;

    const worker = async (): Promise<void> => {
      for (;;) {
        if (stopped) return;
        if (Date.now() > deadline) {
          stopped = true;
          return;
        }
        const index = nextIndex;
        nextIndex += 1;
        const path = missing[index];
        if (path === undefined) return;
        if (bytesUsed >= MAX_TOTAL_BYTES) {
          skipped.push({ path, reason: "byte budget (2MB)" });
          continue;
        }

        const blob = await fetchBlobContent(owner, repo, sha, path);
        processed += 1;
        if (blob.status === "rate-limited") {
          rateLimitedAt = blob.resetAtMs;
          stopped = true;
          skipped.push({ path, reason: "rate limited" });
          return;
        }
        if (blob.status === "too-large") {
          skipped.push({ path, reason: "over 100KB" });
          continue;
        }
        if (blob.status === "binary") {
          skipped.push({ path, reason: "binary content" });
          continue;
        }
        if (blob.status !== "ok") {
          skipped.push({ path, reason: "fetch failed" });
          continue;
        }
        // Size and content hash only. No file body is persisted anywhere.
        await ctx.runMutation(internal.scans.store.saveContent, {
          owner,
          repo,
          sha,
          path,
          contentSha: blob.contentSha,
          size: blob.size,
          truncated: false,
          fetchedAt: Date.now(),
        });
        files.push({ path, content: blob.content, size: blob.size });
        bytesUsed += blob.size;
      }
    };

    if (missing.length > 0) {
      await Promise.all(
        Array.from(
          { length: Math.min(FALLBACK_CONCURRENCY, missing.length) },
          () => worker(),
        ),
      );
      for (let i = nextIndex; i < missing.length; i++) {
        const path = missing[i];
        if (path === undefined) continue;
        if (!files.some((f) => f.path === path) && !skipped.some((s) => s.path === path)) {
          skipped.push({ path, reason: stopped ? "not reached after rate limit" : "not reached" });
        }
      }
    }

    // Analyzers are documented as deterministic, so restore the sorted queue
    // order before any of them see the file list.
    files.sort((a, b) => {
      const ia = selected.indexOf(a.path);
      const ib = selected.indexOf(b.path);
      return ia - ib;
    });
    skipped.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));

    const evidence: EvidenceItem[] = [];
    const findings: FindingItem[] = [];

    for (const match of scanSecrets(files)) {
      const text = SECRET_TEXT[match.ruleId] ?? {
        title: `Review flagged pattern (${match.ruleId})`,
        why: "A risky pattern was seen in a tracked file.",
      };
      const severity = severityFor(match.ruleId);
      pushEvidence(evidence, findings, {
        ruleId: match.ruleId,
        path: match.path,
        line: match.line,
        severity,
        title: text.title,
        why: text.why,
        bucket: severity === "info" ? "info" : "actionable",
        rawSnippet: match.snippet,
      });
    }

    const skippedLarge = skipped
      .filter((s) => s.reason === "over 100KB")
      .map((s) => s.path);
    const hygiene = analyzeHygiene(blobs, files, skippedLarge);
    for (const path of hygiene.envUsages) {
      pushEvidence(evidence, findings, {
        ruleId: "hygiene.env-usage",
        path,
        line: 1,
        severity: "info",
        title: "Reads environment variables",
        why: "This file reads config from the environment at runtime.",
        bucket: "info",
        rawSnippet: "environment variable usage",
      });
    }
    const langSummary = hygiene.languages.map((l) => `${l.language} ${l.files}`).join(", ");
    evidence.push({
      ruleId: "hygiene.languages",
      path: "(repo)",
      line: 0,
      contentHash: fnv1aHex(langSummary),
      redactedSnippet: redactedSnippet(
        `Languages: ${langSummary || "none"}. Entry points: ${hygiene.entryPoints.join(", ") || "none"}.`,
      ),
      severity: "info",
    });

    const hygieneGaps: Array<{ ruleId: string; title: string; why: string; detail: string }> = [];
    if (!hygiene.hasReadme) {
      hygieneGaps.push({
        ruleId: "hygiene.no-readme",
        title: "No README found",
        why: "Judges and users decide in seconds whether they understand the project.",
        detail: "Add a README with what it does and how to run it.",
      });
    }
    if (!hygiene.hasTests) {
      hygieneGaps.push({
        ruleId: "hygiene.no-tests",
        title: "No tests detected",
        why: "Without tests, every change risks silently breaking the demo.",
        detail: "No test files, test directories, or test runners were seen.",
      });
    }
    if (!hygiene.hasCI) {
      hygieneGaps.push({
        ruleId: "hygiene.no-ci",
        title: "No CI workflow detected",
        why: "Without CI, checks only run when someone remembers to run them.",
        detail: "No .github/workflows directory was seen.",
      });
    }
    if (hygiene.duplicateGroups > 0) {
      hygieneGaps.push({
        ruleId: "hygiene.duplicates",
        title: `${hygiene.duplicateGroups} duplicate file groups`,
        why: "Copied files drift apart and fixes land in only one copy.",
        detail: `${hygiene.duplicateGroups} groups of identical files were seen.`,
      });
    }
    if (hygiene.largeFiles.length > 0) {
      hygieneGaps.push({
        ruleId: "hygiene.large-files",
        title: `${hygiene.largeFiles.length} large files skipped`,
        why: "Large files were not examined, so anything inside them is unknown.",
        detail: hygiene.largeFiles.slice(0, 5).join(", "),
      });
    }
    for (const gap of hygieneGaps) {
      pushEvidence(evidence, findings, {
        ruleId: gap.ruleId,
        path: "(repo)",
        line: 0,
        severity: "info",
        title: gap.title,
        why: gap.why,
        bucket: "info",
        rawSnippet: gap.detail,
      });
    }

    const deps = parseManifests(files);
    const manifestByPath = new Map(files.map((f) => [f.path, f.content]));
    for (const script of deps.installScripts) {
      pushEvidence(evidence, findings, {
        ruleId: "deps.install-script",
        path: script.manifest,
        line: manifestLine(manifestByPath.get(script.manifest) ?? "", script.script),
        severity: "high",
        title: `Install script runs on every install (${script.script})`,
        why: "Install scripts run automatically, which makes them a delivery route for attacks.",
        bucket: "actionable",
        rawSnippet: `install script present: ${script.script}`,
      });
    }
    for (const dup of deps.duplicates) {
      pushEvidence(evidence, findings, {
        ruleId: "deps.duplicate",
        path: "(repo)",
        line: 0,
        severity: "low",
        title: `Duplicated dependency (${dup})`,
        why: "The same package twice means two copies to patch and two behaviors.",
        bucket: "actionable",
        rawSnippet: `duplicate dependency: ${dup}`,
      });
    }
    for (const dep of deps.deps) {
      if (!dep.pinned && dep.version.length > 0) {
        pushEvidence(evidence, findings, {
          ruleId: "deps.unpinned-version",
          path: dep.manifest,
          line: manifestLine(manifestByPath.get(dep.manifest) ?? "", dep.name),
          severity: "medium",
          title: `Floating version (${dep.name} ${dep.version})`,
          why: "Floating ranges install different code tomorrow than they do today.",
          bucket: "actionable",
          rawSnippet: `unpinned dependency: ${dep.name} ${dep.version}`,
        });
      }
    }

    const osvTargets = deps.deps.filter(
      (d) => d.version.length > 0 && OSV_ECOSYSTEMS[d.ecosystem] !== undefined,
    );
    const osvWindow = osvTargets.slice(0, 50);
    let osvUnknown = 0;
    const vulnCounts = new Map<string, number>();

    // Cache first, then one batched OSV request for everything still missing.
    // One call per dependency made a 50 package scan take 50 round trips.
    const osvResolved = new Map<
      string,
      { vulns: Array<{ id: string; summary: string; severity: string }>; unknown: boolean }
    >();
    const osvMisses: Array<{ dep: (typeof osvTargets)[number]; ecosystem: string; key: string }> = [];

    for (const dep of osvWindow) {
      const ecosystem = OSV_ECOSYSTEMS[dep.ecosystem] ?? dep.ecosystem;
      const key = `${dep.name}@${dep.version}`;
      const cachedVuln = await ctx.runQuery(internal.scans.store.getOsvEntry, {
        ecosystem,
        name: dep.name,
        version: dep.version,
        sinceMs: Date.now() - OSV_CACHE_TTL_MS,
      });
      if (cachedVuln !== null) {
        osvResolved.set(key, {
          vulns: cachedVuln.timedOut ? [] : cachedVuln.vulns,
          unknown: cachedVuln.timedOut,
        });
        continue;
      }
      osvMisses.push({ dep, ecosystem, key });
    }

    if (osvMisses.length > 0) {
      const batch = await queryOsvBatch(
        osvMisses.map((m) => ({
          ecosystem: m.ecosystem,
          name: m.dep.name,
          version: m.dep.version,
        })),
      );
      for (let i = 0; i < osvMisses.length; i++) {
        const miss = osvMisses[i];
        if (miss === undefined) continue;
        const vulns = batch.timedOut ? [] : batch.results[i] ?? [];
        await ctx.runMutation(internal.scans.store.saveOsvEntry, {
          ecosystem: miss.ecosystem,
          name: miss.dep.name,
          version: miss.dep.version,
          checkedAt: Date.now(),
          timedOut: batch.timedOut,
          vulns,
        });
        osvResolved.set(miss.key, { vulns, unknown: batch.timedOut });
      }
    }

    for (const dep of osvWindow) {
      const key = `${dep.name}@${dep.version}`;
      const resolved = osvResolved.get(key);
      if (resolved === undefined) {
        osvUnknown++;
        continue;
      }
      if (resolved.unknown) {
        osvUnknown++;
        continue;
      }
      for (const vuln of resolved.vulns) {
        const key = `${dep.name}@${dep.version}:${vuln.id}`;
        vulnCounts.set(key, (vulnCounts.get(key) ?? 0) + 1);
        if ((vulnCounts.get(key) ?? 0) > 1) continue;
        const sev: Severity =
          vuln.severity === "high" ? "high" : vuln.severity === "low" ? "low" : "medium";
        pushEvidence(evidence, findings, {
          ruleId: "deps.vulnerability",
          path: dep.manifest,
          line: manifestLine(manifestByPath.get(dep.manifest) ?? "", dep.name),
          severity: sev,
          title: `${vuln.id} affects ${dep.name}@${dep.version}`,
          why: "A public vulnerability record exists for this exact installed version.",
          bucket: "actionable",
          rawSnippet: `${vuln.id} ${dep.name} ${dep.version} ${vuln.summary}`,
        });
      }
    }

    const licenses = analyzeLicenses(blobs, files, files.length > 0);
    evidence.push({
      ruleId: "license.signal",
      path: licenses.files[0] ?? "(repo)",
      line: 0,
      contentHash: fnv1aHex(licenses.detected.join(",")),
      redactedSnippet: redactedSnippet(
        `Licenses: ${licenses.detected.join(", ") || "none"}. Policy: ${licenses.policy}.`,
      ),
      severity: "info",
    });
    if (licenses.policy !== "Allowed") {
      const sev: Severity =
        licenses.policy === "Not recommended" ? "high" : licenses.policy === "Not checked" ? "info" : "medium";
      pushEvidence(evidence, findings, {
        ruleId: "license.policy",
        path: licenses.files[0] ?? "(repo)",
        line: 0,
        severity: sev,
        title: `License needs attention (${licenses.policy})`,
        why: `${licenses.note}`,
        bucket: licenses.policy === "Not checked" ? "info" : "actionable",
        rawSnippet: `license policy: ${licenses.policy}; detected: ${licenses.detected.join(", ") || "none"}`,
      });
    }

    const seen = new Set<string>();
    const uniqueFindings = findings.filter((f) => {
      if (seen.has(f.fingerprint)) return false;
      seen.add(f.fingerprint);
      return true;
    });

    const fetched = files.length;
    const skippedCount = skipped.length;
    const treeNote = scan.truncated === true ? "tree truncated; " : "";
    const coverageNote =
      `Analyzed ${fetched} files at this commit; skipped ${skippedCount} (${treeNote}` +
      `OSV checked ${osvWindow.length} packages, ${osvUnknown} unknown; ` +
      `registry freshness and deps.dev metadata not checked).`;

    let status: "completed" | "partial" | "failed" = "completed";
    let errorKind: "truncated" | "rate_limited" | undefined = undefined;
    let errorMessage: string | undefined = undefined;
    let resetAt: number | undefined = undefined;
    if (rateLimitedAt !== null) {
      status = "partial";
      errorKind = "rate_limited";
      errorMessage = "GitHub quota ran out while fetching file contents. Findings cover fetched files only.";
      resetAt = rateLimitedAt ?? undefined;
    } else if (skippedCount > 0 || scan.truncated === true) {
      status = "partial";
      errorKind = "truncated";
      errorMessage = `Contents incomplete: ${skippedCount} files skipped by caps. Findings cover fetched files only.`;
    }

    await ctx.runMutation(internal.scans.store.clearResults, { scanId: args.scanId });
    await ctx.runMutation(internal.scans.store.saveResults, {
      scanId: args.scanId,
      analyzerVersion: ANALYZER_VERSION,
      analyzedAt: Date.now(),
      fetchedFileCount: fetched,
      skippedFileCount: skippedCount,
      coverageNote,
      status,
      errorKind,
      errorMessage,
      rateLimitResetAt: resetAt,
      evidence: evidence.map((e) => ({
        ruleId: e.ruleId,
        path: e.path,
        line: e.line,
        contentHash: e.contentHash,
        redactedSnippet: e.redactedSnippet,
        severity: e.severity,
      })),
      findings: uniqueFindings.map((f) => ({
        ruleId: f.ruleId,
        fingerprint: f.fingerprint,
        path: f.path,
        line: f.line,
        severity: f.severity,
        title: f.title,
        why: f.why,
        bucket: f.bucket,
      })),
    });

    // Release the slot before returning so a queued scan can start.
    await ctx.runMutation(internal.scans.quota.releaseSlot, { scanId: args.scanId });

    return {
      scanId: args.scanId,
      status,
      findingCount: uniqueFindings.length,
      evidenceCount: evidence.length,
      fetched,
      skipped: skippedCount,
    };
  },
});
