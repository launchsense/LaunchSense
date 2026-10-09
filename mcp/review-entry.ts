// Local review entry. Reads the working tree. Does not call api.github.com.
// Alpha does not check an API key. The auth slot is recorded and not enforced.

import { closeSync, constants, fstatSync, lstatSync, openSync, readdirSync, readFileSync, readSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
import { directoryHandlePath, openReviewRoot } from "./root-boundary.ts";
import {
  MAX_LOCAL_METADATA_BYTES,
  ensureChildDirectory,
  listDirectoryNames,
  openChildDirectory,
  readBoundedFile,
  savedPolicyName,
  savedReportStamp,
  writeFileAtomic,
} from "./local-state.ts";
import type { WriteResult } from "./local-state.ts";
import { decide } from "../shared/adapters/decision.ts";
import type { DecisionQuestion } from "../shared/adapters/decision.ts";
import { queryOsvBatch } from "../shared/adapters/osv.ts";
import { buildLocalReport, OTHER_LOCKFILES, refreshDerivations } from "../shared/review/buildReport.ts";
import type { AdvisoryCoverage, NotChecked, ReviewFile, ReviewFinding, ReviewReport } from "../shared/review/buildReport.ts";
import { diagnosticPayload, diagnosticsAllowed, emptyGovOutcome } from "../shared/review/diagnostics.ts";
import type { GovOutcome } from "../shared/review/diagnostics.ts";
import { completenessFor } from "../shared/review/completeness.ts";
import { LOCAL_FILES_NOTICE_VERSION } from "../shared/consent/vocabulary.ts";
import { applyGovernance, parseGovernance } from "../shared/review/governance.ts";
import type { GovAccept } from "../shared/review/governance.ts";
import { fingerprintFinding } from "../shared/redaction.ts";
import { ANALYZER_VERSION } from "../shared/analyzers/version.ts";
import { inventoryNpmLock } from "../shared/review/lockfile.ts";
import type { LockInventory, LockPackage } from "../shared/review/lockfile.ts";
import { findingsToAsk, laneCanReorder, questionIdFor, rankFromAnswers, rankState } from "../shared/reports/priority.ts";
import type { RankableFinding } from "../shared/reports/priority.ts";
import { buildFixPlan } from "../shared/reports/fixPlan.ts";
import { buildTopPrompt } from "../shared/reports/topPrompt.ts";
import type { PromptFinding } from "../shared/reports/topPrompt.ts";
import { lookupPackages, scorecardFact } from "../shared/review/registry.ts";
import { quoteForChoice, suggestionOptions } from "../shared/review/unknownQuote.ts";
import { parseManifests } from "../shared/analyzers/deps.ts";

// Vendored trees. Skipping them keeps thousands of third-party lines out of a
// review that is about this repo's own code, and every skip is disclosed in the
// not-checked list, so the report never hides the gap.
const VENDORED = new Set(["vendor", "third_party", "3rdparty", "deps"]);

// Installed-package and tool-cache folders. These hold thousands of files that
// belong to downloaded libraries, not to the person being reviewed. Reading them
// buries the repo's own code, and their generic example files produce findings
// that are not about this project at all. Skipped by name, disclosed like any
// other skip. site-packages covers a Python virtualenv under any name.
const PACKAGE_CACHES = new Set([
  ".venv", "venv", ".env.d", "env", ".tox", ".nox", "site-packages",
  ".mypy_cache", ".pytest_cache", ".ruff_cache", ".pytype", ".pyre",
  ".cache", ".turbo", ".nuxt", ".output", ".svelte-kit", ".parcel-cache",
  "out", "bower_components", ".pnp", ".yarn",
]);

const SKIP = new Set([
  "node_modules", "dist", "build", ".git", "coverage", ".next", "vendor", "target", "__pycache__", "third_party",
  // The other names third-party code arrives under. Same rule as vendor and
  // third_party: not read, and named in the not-checked list when skipped.
  ...VENDORED,
  ...PACKAGE_CACHES,
  // The agent working folder. It holds personal and planning material that is
  // nobody's to review, and a review of this repo must never walk into it. Skipped
  // by name, the same as any other unread directory, and disclosed when skipped.
  ".progress",
  // The review's own state folder. The policy is read once, before the walk,
  // through its pinned handle; the walker must not read it again as a source
  // file (a second read would be a second opinion on the same bytes and would
  // race the first one). Its reports and snapshots are the run's own record.
  ".ls",
]);
const BINARY = new Set(["png", "jpg", "jpeg", "gif", "webp", "ico", "zip", "gz", "pdf", "woff", "woff2"]);
const OSV_CAP = 50;
const MAX_FILES = 5000;
const MAX_BYTES = 40_000_000;
const FILE_CAP = 100_000;

interface LocalConfig {
  tier?: string;
  diagnostics?: string;
  agreed?: boolean;
  authRequired?: boolean;
  harness?: string;
  filesAcknowledged?: boolean;
  filesNoticeVersion?: string;
}

/**
 * The agent instruction files. These are the ones the local file-read
 * acknowledgement covers: the review reads them so it knows the project's own
 * rules, and it reads them only when the person acknowledged that read for the
 * wording in force now. Absent, refused, or stale means they are listed as not
 * checked, never read silently.
 */
const AGENT_FILES = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "CURSOR.md",
  ".cursorrules",
  ".windsurfrules",
  "copilot-instructions.md",
]);

function filesReadAcknowledged(config: LocalConfig): boolean {
  return (
    config.filesAcknowledged === true && config.filesNoticeVersion === LOCAL_FILES_NOTICE_VERSION
  );
}

/**
 * Read `.ls/policy.yaml`, apply its acceptances to the report's findings, and
 * write a timestamped copy of the report under `.ls/reports/`.
 *
 * Every outcome is disclosed. A file that is absent changes nothing. A file that
 * is refused suppresses nothing and says why. A file that would silence too much
 * is refused whole. An accepted finding is removed and named as accepted, and an
 * ignored path is named, so a reader can always see what was hidden and why.
 */
function isIgnoredBy(policy: { ignorePaths: Array<{ path: string }> }, finding: { path: string }): boolean {
  return policy.ignorePaths.some(
    (entry) => finding.path === entry.path || finding.path.startsWith(`${entry.path}/`),
  );
}

/**
 * Read `.ls/policy.yaml` from the pinned review root. The file is opened from a
 * pinned parent handle, with the final component refusing a link.
 *
 * Absence is ordinary. A link at `.ls` or at `.ls/policy.yaml`, an unreadable
 * file, or a file over the metadata bound is a refusal, never a silent absence:
 * the report names a relative scope and says why, without printing a handle.
 *
 * This is called ONCE per run. The result is shared with the licence allowlist,
 * the governance application, the saved policy copy, and the change-run prior
 * comparison, so every step decides from the same read. If the read is refused,
 * every step treats it as refused; no later step reads the file again and finds
 * a healthy one after an earlier step found it refused.
 */
type PolicyState =
  | { kind: "absent" }
  | { kind: "refused"; reason: string }
  | { kind: "ok"; text: string };

function readPolicyFile(rootFd: number): PolicyState {
  const ls = openChildDirectory(rootFd, ".ls");
  if (ls.state === "absent") return { kind: "absent" };
  if (ls.state === "refused") return { kind: "refused", reason: ls.reason };
  const lsFd = ls.value;
  try {
    const read = readBoundedFile(lsFd, "policy.yaml", MAX_LOCAL_METADATA_BYTES);
    if (read.state === "absent") return { kind: "absent" };
    if (read.state === "refused") {
      return { kind: "refused", reason: read.reason.replace(/^policy\.yaml/, ".ls/policy.yaml") };
    }
    return { kind: "ok", text: read.value };
  } finally {
    closeSync(lsFd);
  }
}
function applyGovernanceFile(read: PolicyState, report: ReviewReport): GovOutcome {
  const outcome: GovOutcome = emptyGovOutcome();
  if (read.kind === "absent") return outcome;
  if (read.kind === "refused") {
    report.notChecked.push({
      scope: ".ls/policy.yaml",
      reason: `${read.reason} Nothing was suppressed.`,
    });
    outcome.detected = true;
    outcome.refused = "unreadable";
    return outcome;
  }
  const text = read.text;

  outcome.detected = true;
  const parsed = parseGovernance(text);
  if (!parsed.ok) {
    report.notChecked.push({
      scope: ".ls/policy.yaml",
      reason: `Governance file refused (${parsed.reason}): ${parsed.detail}. Nothing was suppressed.`,
    });
    outcome.refused = parsed.reason;
    return outcome;
  }
  const policy = parsed.policy;
  if (policy.consentNoticeVersion !== null && policy.consentNoticeVersion !== LOCAL_FILES_NOTICE_VERSION) {
    outcome.stale = true;
  }

  // Apply once, and only if the file is not a sandbag. The check covers ignored
  // paths as well as acceptances, so a file cannot hide a repo through a long
  // list of ignored directories. On a refusal, nothing changes at all.
  const applied = applyGovernance(report.findings, policy);
  if (applied.sandbag) {
    report.notChecked.push({
      scope: ".ls/policy.yaml",
      reason: "Governance file refused: it would silence too many findings. Nothing was suppressed.",
    });
    outcome.refused = "sandbag";
    outcome.sandbag = true;
    outcome.ignored = policy.ignorePaths.length;
    return outcome;
  }
  outcome.ignored = policy.ignorePaths.length;
  const suppressedByFingerprint = new Set<string>();
  const suppressedByRulePath = new Set<string>();
  const suppressedByRule = new Set<string>();
  for (const accept of policy.accepts) {
    if (accept.fingerprint !== null) {
      for (const finding of applied.suppressed) {
        if (finding.fingerprint === accept.fingerprint) suppressedByFingerprint.add(finding.fingerprint);
      }
    } else if (accept.ruleId !== null && accept.path !== null) {
      for (const finding of applied.suppressed) {
        if (finding.ruleId === accept.ruleId && finding.path === accept.path) {
          suppressedByRulePath.add(finding.fingerprint);
        }
      }
    } else if (accept.ruleId !== null) {
      for (const finding of applied.suppressed) {
        if (
          finding.ruleId === accept.ruleId &&
          !suppressedByFingerprint.has(finding.fingerprint) &&
          !suppressedByRulePath.has(finding.fingerprint)
        ) {
          suppressedByRule.add(finding.fingerprint);
        }
      }
    }
  }
  outcome.suppressedFingerprint = suppressedByFingerprint.size;
  outcome.suppressedRulePath = suppressedByRulePath.size;
  outcome.suppressedRule = suppressedByRule.size;

  // The ignored paths themselves are named by the walk, before the read, with
  // the person's own reason (exclusionReason). No second row is pushed here:
  // the walk's row is the disclosure, pushed once, at the exclusion event.
  if (applied.suppressed.length > 0) {
    for (const finding of applied.suppressed) {
      if (isIgnoredBy(policy, finding)) continue;
      report.notChecked.push({
        scope: finding.path,
        reason: `Accepted in .ls/policy.yaml, so not raised again: ${finding.ruleId}`,
      });
    }
    const hidden = new Set(applied.suppressed.map((finding) => finding.fingerprint));
    report.findings = report.findings.filter((finding) => !hidden.has(finding.fingerprint));
  }

  // A timestamped copy of the report, kept next to the policy, so the repo has
  // its own record of what was found and when. Written by writeLocalReportCopy
  // after completeness is computed, so the copy states the final status.
  return outcome;
}

/**
 * The local review's own persistence. It writes the fallible side files first
 * (the third-party notice, the policy copy, the `.gitignore` line) and returns a
 * flag plus an open reports handle; the caller writes the report markdown last.
 *
 * F27: the report markdown used to be written first, and a later failure in the
 * notice, the policy copy, or `.gitignore` added a not-checked line to a report
 * that had already been saved, leaving a saved copy that read as complete while
 * the run was not. Here every side failure is marked on the report before the
 * markdown is written, so the saved copy and the terminal report carry the same
 * failure; a failure to write the markdown itself is marked after, so it appears
 * in the terminal report only and no new saved copy reads as current.
 *
 * Every path is resolved from a pinned parent handle with the final component
 * refusing a link, so a swapped directory or a link cannot move a write outside
 * the checkout.
 */
function prepareLocalState(rootFd: number, report: ReviewReport, acknowledged: boolean, policy: PolicyState): { reportsFd: number | null; failed: boolean } {
  if (!acknowledged) return { reportsFd: null, failed: false };
  let failed = false;
  const markFailed = (scope: string, reason: string): void => {
    failed = true;
    report.notChecked.push({ scope, reason });
  };
  const ls = ensureChildDirectory(rootFd, ".ls");
  if (ls.state !== "ok") {
    report.notChecked.push({
      scope: ".ls",
      reason: ls.state === "refused" ? ls.reason : ".ls could not be created.",
    });
    return { reportsFd: null, failed: true };
  }
  const lsFd = ls.value;
  try {
    const reports = ensureChildDirectory(lsFd, "reports");
    if (reports.state !== "ok") {
      report.notChecked.push({
        scope: ".ls/reports",
        reason:
          reports.state === "refused"
            ? reports.reason.replace(/^reports\b/, ".ls/reports")
            : ".ls/reports could not be created.",
      });
      return { reportsFd: null, failed: true };
    }
    const reportsFd = reports.value;
    const stamp = savedReportStamp();
    // The third-party notice is its own file, so the report body stays a report
    // and the notice stays a document the person can commit. Same one per run.
    if (report.licenseDeclaration !== null) {
      const noticeName = report.licenseDeclaration.noticeFilename.replace(/[^\w.-]/g, "-");
      const wrote = writeFileAtomic(reportsFd, `${stamp}-${noticeName}`, report.licenseDeclaration.notice);
      if (!wrote.ok) markFailed(".ls/reports", `The third-party notice was not written: ${wrote.reason}`);
    }
    // Keep a copy of the governance file next to the report, so the next change
    // run can diff a newly added acceptance against it. .ls/ is gitignored, so
    // this copy is the only prior record of the policy.
    //
    // The snapshot is written from the run's single policy read:
    //   - ok: the exact bytes that were read are recorded.
    //   - absent: an empty policy is recorded. Absence is a real state, and a
    //     later run must not be compared against a snapshot from before the file
    //     was absent.
    //   - refused (a link, unreadable, or over-bound file): NO snapshot is
    //     written at all. Recording an empty policy here would manufacture a
    //     false baseline, and a later run could then report the real policy's
    //     acceptances as "newly added". The refusal is disclosed instead.
    if (policy.kind === "ok") {
      const wrotePolicy = writeFileAtomic(reportsFd, savedPolicyName(stamp), policy.text);
      if (!wrotePolicy.ok) markFailed(".ls/reports", `The policy copy was not written: ${wrotePolicy.reason}`);
    } else if (policy.kind === "absent") {
      const wrotePolicy = writeFileAtomic(reportsFd, savedPolicyName(stamp), "version: 1\naccepts: []\n");
      if (!wrotePolicy.ok) markFailed(".ls/reports", `The policy copy was not written: ${wrotePolicy.reason}`);
    } else {
      markFailed(".ls/policy.yaml", `No policy copy was recorded: ${policy.reason}`);
    }
    const ignore = ensureGitignored(rootFd);
    if (!ignore.ok) markFailed(".gitignore", ignore.reason);
    return { reportsFd, failed };
  } finally {
    closeSync(lsFd);
  }
}

/**
 * Write the saved copy of the report. On failure it returns true; the caller
 * marks the failure and appends the reason AFTER the markdown is written, so the
 * saved copy and the terminal report carry the same failure. A failure to write
 * the markdown itself is disclosed and there is no saved copy to mislead.
 */
function writeSavedReport(reportsFd: number, report: ReviewReport): boolean {
  // The saved copy carries no usage-count line. The send is decided AFTER the
  // copy is written, so this render knows nothing about it, and anything it
  // said here would be fabricated: a bare "not sent" line in the copy of an
  // opted-in, successfully sent run would read as a consent answer the run's
  // own config disproves. The usage-count line is a fact about the tool output
  // only; the saved copy states nothing about the send.
  const wrote = writeFileAtomic(
    reportsFd,
    `${savedReportStamp()}.md`,
    render(report, null, null),
  );
  return !wrote.ok;
}

/**
 * Append one local-persistence failure to the completeness line, once. The run
 * is partial, and the same line goes into the saved copy and the terminal report
 * because both are built from the report after this runs.
 */
function markLocalStateFailure(report: ReviewReport, reason: string): void {
  report.status = "partial";
  if (report.statusNote.includes(reason)) return;
  report.statusNote =
    report.statusNote === "Review complete."
      ? `Review incomplete: ${reason}.`
      : `${report.statusNote.slice(0, -1).replace(/\.$/, "")}; ${reason}.`;
}

/**
 * Keep `.ls/` out of git. The folder is the repo's private memory: the findings
 * a person accepted and the reports they ran. It stays on the machine, so the
 * first time the review writes it, it adds one line to `.gitignore` if the line
 * is not already there. A repo that deliberately commits the file removes the
 * line; that is a choice a person makes, not a default.
 *
 * When the update cannot be made, that is stated rather than swallowed. Saying
 * nothing would let the report imply `.ls/` is kept private by `.gitignore` when
 * the line was never written.
 */
function ensureGitignored(rootFd: number): WriteResult {
  const read = readBoundedFile(rootFd, ".gitignore", MAX_LOCAL_METADATA_BYTES);
  if (read.state === "refused") {
    return { ok: false, reason: `.gitignore was not updated: ${read.reason}` };
  }
  const current = read.state === "ok" ? read.value : "";
  const present = current
    .split("\n")
    .some((line) => [".ls/", "/.ls/", ".ls", "/.ls"].includes(line.trim()));
  if (present) return { ok: true };
  const body = current.length > 0 && !current.endsWith("\n") ? `${current}\n` : current;
  const wrote = writeFileAtomic(rootFd, ".gitignore", `${body}\n# LaunchSense governance. Kept on this machine only.\n.ls/\n`, 0o644);
  if (!wrote.ok) return { ok: false, reason: `.gitignore was not updated: ${wrote.reason}` };
  return { ok: true };
}

function argRoot(): string {
  const index = process.argv.indexOf("--root");
  const value = index >= 0 ? process.argv[index + 1] : undefined;
  return value !== undefined && value.length > 0 ? value : process.cwd();
}

// A change run's scope: the changed paths and the base it was taken from. The
// base is always named, never left as HEAD, because base = HEAD yields the
// empty range HEAD..HEAD, which reads as "no change" rather than "unknown".
//
// Scope is the changed FILES, not changed lines. The analyzers report one hit
// per file for some rules and use a placeholder line for whole-file rules (a
// tracked .env, a licence file), so a line-level filter would drop a finding a
// change introduced: a new console.log below an unchanged one, or a secret
// added to a tracked .env. Reviewing each changed file in full never loses a
// change-caused finding, and the report names the scope as a file count.
interface ChangeScope {
  note: string;
  changed: Set<string>;
  deleted: Set<string>;
  /** The resolved base commit, so a caller can read a file as it was at the base. */
  basePoint: string;
}

// A README, a licence file, or a manifest. The change filter uses these to
// decide whether a repo-level or licence finding was caused by the change.
const README_FILE = /readme([-_.][a-z0-9]+)*$/i;
const LICENCE_FILE = /(licen[cs]e|copying|unlicen[cs]e|notice)([-_.][a-z0-9]+)*$/i;
const MANIFEST_FILES = new Set([
  "package.json", "requirements.txt", "pyproject.toml", "setup.py", "setup.cfg",
  "cargo.toml", "go.mod", "pom.xml", "build.gradle", "build.gradle.kts",
  "gemfile", "composer.json", "pubspec.yaml", "mix.exs", "pipfile",
]);

// The licence a manifest declares, normalized for comparison. Mirrors the
// licence analysis, which reads package.json, Cargo.toml, and pyproject.toml, so
// a licence finding is admitted only when the signal actually changed, and a
// version-only edit never admits it.
function manifestLicenceToken(content: string, base: string): string {
  if (base === "package.json") {
    try {
      const data = JSON.parse(content) as Record<string, unknown>;
      const licence = data["license"];
      return typeof licence === "string" ? licence : "";
    } catch {
      return "";
    }
  }
  if (base === "cargo.toml") {
    return /^license\s*=\s*"([^"]+)"/m.exec(content)?.[1] ?? "";
  }
  if (base === "pyproject.toml") {
    return /license\s*=\s*["']([^"']+)["']/.exec(content)?.[1] ?? "";
  }
  return "";
}

// The identity of one governance acceptance, for comparing two policy files.
function acceptKey(accept: GovAccept): string {
  if (accept.fingerprint !== null) return `f:${accept.fingerprint}`;
  if (accept.ruleId !== null && accept.path !== null) return `rp:${accept.ruleId}:${accept.path}`;
  return `r:${accept.ruleId ?? ""}`;
}

/**
 * A saved policy snapshot name: the run stamp followed by `.policy.yaml`. Only
 * these are prior-copy candidates, so an unrelated `foo.policy.yaml` a person
 * dropped in the folder is never used as a baseline.
 */
const PRIOR_POLICY_NAME = /^\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z\.policy\.yaml$/;

/**
 * The acceptances added to `.ls/policy.yaml` since the last report. `.ls/` is
 * gitignored, so a git change list never sees it: this diffs the run's single
 * policy read against the newest policy snapshot under `.ls/reports/`. It returns
 * which source it used, and claims nothing rather than calling every acceptance
 * new.
 *
 * Truthful labels matter here. When the current policy was refused, the
 * comparison is not "no prior copy": it is that the current policy could not be
 * read, and no acceptance is claimed either way. When the newest snapshot is
 * unreadable or refused, the comparison is unavailable, not empty, and it does
 * not fall back to an older snapshot. Only a genuine older snapshot that parses
 * is used as a baseline.
 */
function detectNewAcceptances(read: PolicyState, rootFd: number): { rows: GovAccept[]; source: string; priorName: string | null; note?: string } {
  if (read.kind === "refused") return { rows: [], source: "policy-unreadable", priorName: null };
  if (read.kind === "absent") return { rows: [], source: "none", priorName: null };
  const parsed = parseGovernance(read.text);
  if (!parsed.ok || parsed.policy.accepts.length === 0) return { rows: [], source: "none", priorName: null };
  const ls = openChildDirectory(rootFd, ".ls");
  // The policy read and the comparison are separate opens of `.ls`, so the
  // folder can be replaced or vanish in between. That is not "no prior copy":
  // the comparison could not run at all, and the caller must disclose it
  // instead of staying silent. Absence and refusal both mean the comparison
  // was unreachable; the reason travels with the result.
  if (ls.state === "absent") return { rows: [], source: "ls-unreachable", priorName: null, note: "The .ls folder disappeared during the run, so it could not be opened for the comparison." };
  if (ls.state !== "ok") return { rows: [], source: "ls-unreachable", priorName: null, note: ls.reason };
  const lsFd = ls.value;
  try {
    const listed = listDirectoryNames(lsFd, "reports");
    // A reports folder that cannot be listed is not the same as one that is
    // absent: calling it "no prior copy" would claim nothing was there when the
    // truth is it could not be read. The caller discloses the refusal.
    if (listed.state === "refused") return { rows: [], source: "reports-unreadable", priorName: null };
    if (listed.state === "absent") return { rows: [], source: "no-prior-copy", priorName: null };
    const priorNames = listed.value.filter((name) => PRIOR_POLICY_NAME.test(name)).sort();
    const priorName = priorNames.length > 0 ? priorNames[priorNames.length - 1] : null;
    if (priorName === null) return { rows: [], source: "no-prior-copy", priorName: null };
    const reports = openChildDirectory(lsFd, "reports");
    if (reports.state !== "ok") return { rows: [], source: "prior-unreadable", priorName };
    const reportsFd = reports.value;
    try {
      const prior = readBoundedFile(reportsFd, priorName, MAX_LOCAL_METADATA_BYTES);
      if (prior.state !== "ok") return { rows: [], source: "prior-unreadable", priorName };
      const priorParsed = parseGovernance(prior.value);
      if (!priorParsed.ok) return { rows: [], source: "prior-refused", priorName };
      const priorKeys = new Set(priorParsed.policy.accepts.map(acceptKey));
      return {
        rows: parsed.policy.accepts.filter((accept) => !priorKeys.has(acceptKey(accept))),
        source: priorName,
        priorName,
      };
    } finally {
      closeSync(reportsFd);
    }
  } finally {
    closeSync(lsFd);
  }
}

// The rule and the path a fingerprint names, in the form
// ruleId:analyzerVersion:path:hash[:occurrence]. A path has no colon, so a
// 4-part fingerprint is ruleId, version, path, hash, and a 5-part one adds an
// occurrence. Reading it this way does not confuse an all-digit hash for an
// occurrence number.
function fingerprintIdentity(fingerprint: string): { rule: string; path: string } {
  const parts = fingerprint.split(":");
  const rule = parts[0] !== undefined && parts[0] !== "" ? parts[0] : "unknown";
  if (parts.length === 4) return { rule, path: parts[2] ?? "" };
  if (parts.length > 4) return { rule, path: parts.slice(2, parts.length - 2).join(":") };
  return { rule, path: "" };
}

// The rule and the path an acceptance names. When a fingerprint is present it
// is the identity the suppression uses, so its rule and path take priority over
// a stated ruleId or path. A fingerprint-only acceptance still names the path it
// accepted.
function acceptanceIdentity(row: GovAccept): { rule: string; path: string } {
  if (row.fingerprint !== null) {
    const fromFingerprint = fingerprintIdentity(row.fingerprint);
    return {
      rule: fromFingerprint.rule !== "" ? fromFingerprint.rule : row.ruleId ?? "unknown",
      path: fromFingerprint.path !== "" ? fromFingerprint.path : row.path ?? "(any path)",
    };
  }
  return { rule: row.ruleId ?? "unknown", path: row.path ?? "(any path)" };
}

// One info row per newly added acceptance, naming the rule and the path. It is
// a disclosure, never a block, and it never rises above info.
function acceptanceFindings(rows: GovAccept[], source: string): ReviewFinding[] {
  return rows.map((row) => {
    const { rule, path } = acceptanceIdentity(row);
    const named = path !== "(any path)" ? ` at ${path}` : "";
    return {
      ruleId: "governance.acceptance-added",
      path: path === "(any path)" ? ".ls/policy.yaml" : path,
      line: 1,
      severity: "info",
      title: `Governance acceptance newly added: ${rule}${named}`,
      why: `A .ls/policy.yaml acceptance for ${rule}${named} was added since the last report (${source}). This is a disclosure, never a block, and it never rises above info.`,
      fingerprint: fingerprintFinding("governance.acceptance-added", ANALYZER_VERSION, path, rule),
    };
  });
}

// git runs one git command in the checkout and returns its trimmed stdout, or
// marks the call as failed. stderr is dropped so a git message never leaks into
// the report; the caller decides what a failure means.
function gitStdio(root: string): Array<"ignore" | "pipe" | number> {
  const stdio: Array<"ignore" | "pipe" | number> = ["ignore", "pipe", "ignore"];
  const handle = root.match(/^\/(?:proc\/self|dev)\/fd\/(\d+)$/);
  if (handle !== null) {
    const fd = Number(handle[1]);
    // Git resolves its own /proc/self/fd path after exec. Preserve exactly the
    // pinned directory descriptor at that number, not arbitrary open files.
    while (stdio.length <= fd) stdio.push("ignore");
    stdio[fd] = fd;
  }
  return stdio;
}

function git(root: string, args: string[]): { ok: boolean; out: string } {
  try {
    const out = execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: gitStdio(root),
    });
    return { ok: true, out: out.trim() };
  } catch {
    return { ok: false, out: "" };
  }
}

// gitNul runs a git command whose output is NUL-separated and returns the
// entries. NUL separation is how a path with a space, a tab, or a non-ASCII
// character survives without git quoting it and breaking the match against the
// walk's own paths.
function gitNul(root: string, args: string[]): { ok: boolean; entries: string[] } {
  try {
    const out = execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: gitStdio(root),
    });
    const entries = out.split("\u0000").filter((entry) => entry !== "");
    return { ok: true, entries };
  } catch {
    return { ok: false, entries: [] };
  }
}

/**
 * The exclusion sources, resolved BEFORE the walk reads any content.
 *
 * Three facts feed one rule: a file the repo's `.gitignore` excludes, a file the
 * person excluded in `.ls/policy.yaml`, and a file an `.ignore` file excludes
 * under the documented subset. None of them may be read and analysed first and
 * dropped later, because reading a private path is itself the harm this closes.
 *
 * Fail closed, and say which source is not applied rather than pretending it is
 * clean:
 *   - inside a Git work tree, `.gitignore` is honoured through real Git (`git
 *     check-ignore`); if Git fails, the Git side is not applied, nothing
 *     invented on its behalf, and the untracked set stays unknown.
 *   - not inside a Git work tree: there is no Git answer at all. Disclosed once,
 *     plainly; `.gitignore` and tracked status are not applied and not invented.
 *   - an `.ignore` file that is a link, unreadable, or over the 1 MiB metadata
 *     bound is refused and disclosed; the paths it might have excluded are NOT
 *     read. Absence is ordinary.
 *
 * What is deliberately not claimed: nested `.gitignore` files under a non-Git
 * tree (Git only runs inside its own tree), and `.ignore` glob characters. The
 * subset is named in docs/LIMITS.md and in the not-checked line itself.
 *
 * Where the word "Git" fails to name an available binary at all (no `git` on
 * PATH), every command below fails the same way, so the same not-git
 * disclosure covers it: the folder reports not a Git working tree as far as
 * this run could measure, the ignore source is named as not applied, and
 * tracked-env is named as not judged. Nothing is invented on a missing
 * binary's behalf either.
 */
const IGNORE_SUBSET_NOTE =
  "This .ignore file is honoured for a documented subset only: comment lines, blank lines, and " +
  "one clean segment per line naming a file or directory under this file's own folder. Glob " +
  "characters, negation, anchored or slashed paths, and whitespace-bearing names are not honoured " +
  "here; other tools reading the same file will ignore more than this review does.";

interface GitExclusionFacts {
  /** True only when `git rev-parse --is-inside-work-tree` answered true. */
  insideWorkTree: boolean;
  /** null when tracked status is unknown: not a Git tree, or Git failed. */
  tracked: Set<string> | null;
  /** A failure in check-ignore or ls-files inside an otherwise valid tree. */
  failed: boolean;
}

type GitIgnoreStatus =
  | { state: "applied"; ignoredPaths: ReadonlySet<string> }
  | { state: "not_a_git_tree" }
  | { state: "failed" };

/**
 * Compute the tracked set and the Git work tree fact. Run once per review,
 * before the walk. Plain `git ls-files` (no `--full-name`) answers path
 * RELATIVE TO THE REVIEW ROOT, because `-C` makes the review root Git's cwd;
 * that is exactly the walk's own relative path space, and it is invariant the
 * tracked-env rule relies on. With `--full-name` the answers came back
 * repo-root-relative, so from a subdirectory review root a genuinely tracked
 * `.env` missed the set silently. From a subdirectory root the listing covers
 * the review root's subtree only, which is right: the walk opens nothing
 * outside it.
 */
function gitTrackedSet(root: string): GitExclusionFacts {
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.out.trim() !== "true") return { insideWorkTree: false, tracked: null, failed: false };
  const listed = gitNul(root, ["ls-files", "-z"]);
  if (!listed.ok) return { insideWorkTree: true, tracked: null, failed: true };
  return { insideWorkTree: true, tracked: new Set(listed.entries), failed: false };
}

/**
 * gitStdio for a command that READS ITS STDIN (check-ignore --stdin). The root
 * descriptor must still be preserved at its own number so the /proc/self/fd
 * root path resolves inside the child, but slot 0 must be a pipe: with
 * stdio[0] = "ignore" and an `input` option, Node discards the input silently
 * and git answers on an empty candidate list, reading as "nothing ignored".
 * That silent loss would look exactly like a clean exclusion pass, so stdin is
 * always a pipe here and the caller asserts on the answer it gets back.
 */
function gitStdioWithInput(root: string): Array<"ignore" | "pipe" | number> {
  const stdio: Array<"ignore" | "pipe" | number> = ["pipe", "pipe", "ignore"];
  const handle = root.match(/^\/(?:proc\/self|dev)\/fd\/(\d+)$/);
  if (handle !== null) {
    const fd = Number(handle[1]);
    while (stdio.length <= fd) stdio.push("ignore");
    stdio[fd] = fd;
  }
  return stdio;
}

/**
 * The pre-read `.gitignore` decisions for one tree, and the exact ignored set.
 *
 * Candidates are EVERY untracked path expanded (`git ls-files --others -z`, no
 * `--directory` and no `--exclude-standard`), NUL-separated, in one batched
 * call, so a repo with a large tree costs one Git process, not one per path.
 * No `--directory`: a directory-collapsed candidate (`sub/`) would be judged
 * by the parent's rules alone and a nested `.gitignore` under it would never
 * be consulted, so its negations would be unanswerable. Per-file candidates
 * let Git resolve nested files, negation, and directory rules fully. No
 * `--exclude-standard`: that flag pre-drops ignored paths in the listing
 * itself, which would make the candidate set unreadable-when-ignored and the
 * check a tautology. Tracked files are not candidates: Git's own semantics say
 * a tracked file is not ignorable, and a tracked `.env` is judged by the
 * tracked-env rule instead, which needs it read.
 *
 * The candidates go to `git check-ignore --stdin -z` (plain, no `-v`), so
 * nested `.gitignore` files, negation (`!`), directory rules, and the
 * tracked-file precedence are all Git's own semantics; this engine never
 * re-implements the pattern language. Plain mode answers ONLY the paths Git
 * really ignores; the `-v` form also names paths matched by a negation line,
 * which would exclude a file the negation re-includes, so it is not used. The
 * answer is exactly the ignored set, nothing invented.
 *
 * On any Git failure the source is not applied and the caller discloses it;
 * the paths that might be ignored are then still read, which is exactly why
 * that state is reported and never presented as clean.
 */
function computeGitIgnores(root: string, facts: GitExclusionFacts): GitIgnoreStatus {
  if (!facts.insideWorkTree) return { state: "not_a_git_tree" };
  const candidates = gitNul(root, ["ls-files", "--others", "-z"]);
  if (!candidates.ok) return { state: "failed" };
  // Directory entries carry a trailing slash. Git's own check-ignore answers
  // with the same trailing slash for directory patterns, but the exclusion set
  // holds clean relative paths, so both sides are normalised once, here.
  const normalised = candidates.entries.map((entry) => (entry.endsWith("/") ? entry.slice(0, -1) : entry));
  const answer = checkGitIgnoreSet(root, normalised);
  if (answer === null) return { state: "failed" };
  return { state: "applied", ignoredPaths: answer };
}

/**
 * check-ignore (plain, -z) answers NUL-separated, exactly the candidates Git
 * judged ignored, nothing else and nothing invented. exit 1 with no output
 * means "none of these are ignored", which is a real answer; any other
 * failure is a refusal.
 */
function checkGitIgnoreSet(root: string, candidates: string[]): Set<string> | null {
  if (candidates.length === 0) return new Set();
  try {
    const out = execFileSync("git", ["-C", root, "check-ignore", "--stdin", "-z"], {
      encoding: "utf8",
      input: `${candidates.join("\u0000")}\u0000`,
      stdio: gitStdioWithInput(root),
    });
    const entries = out.split("\u0000").filter((entry) => entry !== "");
    const ignored = new Set<string>();
    for (const path of entries) {
      if (path === "") continue;
      if (path.endsWith("/")) ignored.add(path.slice(0, -1));
      else ignored.add(path);
    }
    return ignored;
  } catch (error) {
    const status = (error as NodeJS.ErrnoException & { status?: number }).status;
    if (status === 1) return new Set();
    return null;
  }
}

/**
 * The `.ignore` files, top-level and nested, read through the SAME pinned
 * helpers every other local metadata read uses. The format is honoured for a
 * documented SUBSET, parsed here and nowhere else and named in the not-checked
 * line when it applies. A link, an unreadable file, or a file over the
 * 1 MiB metadata bound is refused and disclosed; the paths it might have
 * excluded are then not read, which is the whole point of refusing.
 *
 * Exclusion-before-read extends to this scan itself: a directory excluded by
 * `.ls/policy.yaml` ignorePaths, by git's answers (exclusionsFromPaths), or by
 * the coverage of an outer `.ignore` is not opened and not descended into, and
 * an `.ignore` file at an excluded path itself is not read. The exclusion
 * source that owns such a path already discloses it when the walk skips it; no
 * second row is emitted here.
 */
interface IgnoreFileOutcome {
  /** Paths covered, clean relative, directory-or-file. */
  covered: Set<string>;
  /** Per-file refusals, already worded for the not-checked list. */
  refusals: NotChecked[];
}

function readIgnoreFiles(
  rootFd: number,
  flags: WalkFlags,
  exclusionsFromPaths: ReadonlySet<string>,
  policyExcludedPaths: ReadonlySet<string>,
): IgnoreFileOutcome {
  const outcome: IgnoreFileOutcome = { covered: new Set(), refusals: [] };
  // Exclusion-before-read also applies inside this scan. aPathMatchesSet uses
  // the same matching the governance layer uses: the path itself, or anything
  // under a named directory. The git set is exact answers per path, and the
  // policy set holds file and directory names.
  const pathExcluded = (path: string): boolean => {
    if (exclusionsFromPaths.has(path)) return true;
    if (policyExcludedPaths.has(path)) return true;
    const parts = path.split("/");
    for (let at = 1; at < parts.length; at++) {
      const ancestor = parts.slice(0, at).join("/");
      if (policyExcludedPaths.has(ancestor)) return true;
    }
    return false;
  };
  const stack: Array<{ fd: number; dir: string }> = [{ fd: rootFd, dir: "" }];
  while (stack.length > 0) {
    const top = stack.pop();
    if (top === undefined) break;
    // This entry is either the borrowed root descriptor or one this loop
    // opened. Close the ones it opened, always, and never the root's.
    const borrowed = top.fd === rootFd;
    try {
      // The current directory's OWN .ignore is handled BEFORE its children are
      // pushed for descent, so every exclusion it makes is already in force
      // when each child is checked for descent. A directory named by it (or by
      // the policy set, or by the git answers handed in) is never opened at
      // all, exactly as the walk itself then never opens it.
      //
      // A listing that fails is the walker's unreadable fact too. The listing
      // here is often the first readdir on the pinned root, so eating a
      // failure silently would let the walk look clean on a directory this
      // pass could not name children of. The same words the walker uses are
      // recorded, once per directory, and the same flag is set, so the run
      // stays partial. The directory itself is still walked afterwards; only
      // the nested .ignore discovery is blind there, which is exactly what a
      // failed listing must mean.
      const listed = listDirectoryNames(top.fd, ".");
      if (listed.state !== "ok") {
        flags.unreadable = true;
        outcome.refusals.push({
          scope: top.dir === "" ? "(repo)" : `${top.dir}/.ignore`,
          reason: "The directory could not be read.",
        });
        continue;
      }
      const ignoreFilePath = top.dir === "" ? ".ignore" : `${top.dir}/.ignore`;
      // An .ignore file at an excluded path itself (named by the policy set,
      // excluded by git, or covered by an outer .ignore) is not read either:
      // exclusion-before-read extends to the ignore files themselves. No row
      // is added here; the exclusion source that owns the path already
      // discloses it when the walk names that path as ignored.
      if (!pathExcluded(ignoreFilePath)) {
        const ignore = readBoundedFile(top.fd, ".ignore", MAX_LOCAL_METADATA_BYTES);
        if (ignore.state === "refused") {
          const scope = top.dir === "" ? ".ignore" : `${top.dir}/.ignore`;
          outcome.refusals.push({
            scope,
            reason: `${ignore.reason.replace(/^\.ignore/, "The .ignore file")} No paths it might exclude were read.`,
          });
        } else if (ignore.state === "ok") {
          // The subset: lines that are blank or start with `#` are skipped; every
          // other line is one clean relative segment with no globs and no
          // negation, naming a file or a directory under THIS directory. Anything
          // past the subset is not honoured, and the file is named so the report
          // never claims full coverage. A line past the subset leaves the whole
          // file's honoured lines in force (they are the documented subset and
          // they were parsed); it only means the file is also disclosed as
          // partially honoured.
          let subsetUsed = false;
          for (const raw of ignore.value.split("\n")) {
            const line = raw.trim();
            if (line.length === 0 || line.startsWith("#")) continue;
            if (
              line.startsWith("!") || line.startsWith("/") ||
              line.includes("*") || line.includes("?") || line.includes("[") || line.includes("\\") ||
              line.includes("/") || /\s/.test(line)
            ) {
              subsetUsed = true;
              continue;
            }
            const full = top.dir === "" ? line : `${top.dir}/${line}`;
            outcome.covered.add(full);
          }
          if (subsetUsed) {
            const scope = top.dir === "" ? ".ignore" : `${top.dir}/.ignore`;
            outcome.refusals.push({ scope, reason: IGNORE_SUBSET_NOTE });
          }
        }
        // Absence is ordinary.
      }
      // NOW the children, with the current directory's own answers in force. An
      // excluded directory holds no .ignore this review needs: its contents
      // are excluded anyway, so it is not opened and not descended into --
      // checked here against the covered set (this directory's own .ignore),
      // the git answers, and the policy set, before any open.
      for (const name of listed.value) {
        if (SKIP.has(name)) continue;
        const childPath = top.dir === "" ? name : `${top.dir}/${name}`;
        if (outcome.covered.has(childPath) || pathExcluded(childPath)) continue;
        const child = openChildDirectory(top.fd, name);
        if (child.state !== "ok") continue;
        stack.push({ fd: child.value, dir: childPath });
      }
    } finally {
      if (!borrowed) closeSync(top.fd);
    }
  }
  return outcome;
}

/**
 * The files in scope for a change run: everything changed since the base,
 * uncommitted and untracked included, plus the base named in words. The base is
 * the merge-base with the upstream branch; with no upstream it falls back to the
 * default branch and names it. With neither, it fails closed rather than
 * silently comparing HEAD to itself, which reads as "no change". A git command
 * that fails is an error, never an empty result, because an empty result would
 * read as "nothing changed".
 */
function resolveChangeScope(root: string): ChangeScope {
  const inside = git(root, ["rev-parse", "--is-inside-work-tree"]);
  if (!inside.ok || inside.out !== "true") {
    throw new Error(
      "Change mode needs a git working tree. This folder is not one, so no change can be scoped. Run the review without mode for a whole-tree review.",
    );
  }
  const headShort = git(root, ["rev-parse", "--short", "HEAD"]);
  const head = headShort.ok && headShort.out !== "" ? headShort.out : "HEAD";
  let baseRef: string;
  let baseLabel: string;
  const upstream = git(root, ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"]);
  if (upstream.ok && upstream.out !== "" && !upstream.out.includes("@{")) {
    baseRef = upstream.out;
    baseLabel = upstream.out;
  } else {
    const originHead = git(root, ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"]);
    let candidate = originHead.ok && originHead.out.startsWith("origin/") ? originHead.out : "";
    if (candidate === "") {
      const current = git(root, ["rev-parse", "--abbrev-ref", "HEAD"]);
      const currentBranch = current.ok ? current.out : "";
      for (const name of ["origin/main", "origin/master", "main", "master"]) {
        // The branch we are on is not a base: comparing it to itself is the
        // empty range HEAD..HEAD, which reads as "no change" and drops every
        // unpushed commit.
        if (name === currentBranch) continue;
        if (git(root, ["rev-parse", "--verify", "--quiet", `${name}^{commit}`]).ok) {
          candidate = name;
          break;
        }
      }
    }
    if (candidate === "") {
      // No upstream and no other branch to compare against. Compare against the
      // first commit and name it, so nothing committed is omitted and the base
      // is never silently HEAD.
      const first = git(root, ["rev-list", "--max-parents=0", "HEAD"]);
      if (!first.ok || first.out === "") {
        throw new Error(
          "Change mode found no upstream, no default branch, and no commit to compare against, so the base is unknown. The review will not silently review HEAD. Run without mode for a whole-tree review.",
        );
      }
      baseRef = first.out.split("\n")[0];
      baseLabel = "the first commit";
    } else {
      baseRef = candidate;
      baseLabel = candidate;
    }
  }
  const mergeBase = git(root, ["merge-base", baseRef, "HEAD"]);
  if (!mergeBase.ok || mergeBase.out === "") {
    throw new Error(
      `Change mode could not find a merge-base with ${baseLabel}, so the range is unknown and nothing is claimed about the change. Run without mode for a whole-tree review.`,
    );
  }
  const basePoint = mergeBase.out;
  const baseShort = git(root, ["rev-parse", "--short", basePoint]);
  const baseCommit = baseShort.ok && baseShort.out !== "" ? baseShort.out : basePoint;

  const diff = gitNul(root, ["diff", "--name-only", "-z", basePoint]);
  if (!diff.ok) {
    throw new Error("Change mode could not read the diff, so the change is unknown and nothing is claimed.");
  }
  // The index against the base as well, so a change that was staged and then
  // reverted on disk is still in scope rather than reading as no change.
  const cached = gitNul(root, ["diff", "--cached", "--name-only", "-z", basePoint]);
  if (!cached.ok) {
    throw new Error("Change mode could not read the staged changes, so the change is unknown and nothing is claimed.");
  }
  const untracked = gitNul(root, ["ls-files", "--others", "--exclude-standard", "-z"]);
  if (!untracked.ok) {
    throw new Error("Change mode could not list untracked files, so the change is unknown and nothing is claimed.");
  }
  const deletedResult = gitNul(root, ["diff", "--name-only", "--diff-filter=D", "--no-renames", "-z", basePoint]);
  if (!deletedResult.ok) {
    throw new Error("Change mode could not read the deletions, so the change is unknown and nothing is claimed.");
  }

  const changed = new Set<string>();
  for (const entry of diff.entries) changed.add(entry);
  for (const entry of cached.entries) changed.add(entry);
  for (const entry of untracked.entries) changed.add(entry);
  const deleted = new Set<string>(deletedResult.entries);

  return {
    note: `Reviewed: change from ${baseLabel} at ${baseCommit} to ${head}, ${changed.size} files.`,
    changed,
    deleted,
    basePoint,
  };
}

/**
 * The repo's licence allowlist from `.ls/policy.yaml`, if it parses. Absent or
 * refused means an empty allowlist, which simply ranks no id as allowed. Only
 * licence ids come back, so no other field of the file is read here. It decides
 * from the run's single policy read, so a refusal seen earlier stays a refusal.
 */
function readLicenceAllow(read: PolicyState): string[] {
  if (read.kind !== "ok") return [];
  const parsed = parseGovernance(read.text);
  return parsed.ok ? parsed.policy.licenceAllow : [];
}

function readConfig(): LocalConfig {
  const home = process.env["HOME"];
  if (home === undefined) return {};
  try {
    const raw = readFileSync(join(home, ".config", "launchsense", "config.json"), "utf8");
    const data = JSON.parse(raw) as unknown;
    if (typeof data !== "object" || data === null) return {};
    const record = data as Record<string, unknown>;
    return {
      tier: typeof record["tier"] === "string" ? record["tier"] : undefined,
      diagnostics: typeof record["diagnostics"] === "string" ? record["diagnostics"] : undefined,
      agreed: record["agreed"] === true,
      authRequired: record["authRequired"] === true,
      harness: typeof record["harness"] === "string" ? record["harness"] : undefined,
      filesAcknowledged:
        typeof record["filesConsent"] === "object" && record["filesConsent"] !== null
          ? (record["filesConsent"] as Record<string, unknown>)["acknowledged"] === true
          : false,
      filesNoticeVersion:
        typeof record["filesConsent"] === "object" && record["filesConsent"] !== null
          ? ((record["filesConsent"] as Record<string, unknown>)["noticeVersion"] as string | undefined)
          : undefined,
    };
  } catch {
    return {};
  }
}

/**
 * The three walk outcomes that make a run partial. They are kept apart from the
 * shared skipped list because "a vendored tree was skipped" and "a binary file
 * was skipped" are different facts: the first leaves notices unchecked, and the
 * second is not a check that applies. Completeness is built from these flags,
 * not from the length of the skipped list.
 */
interface WalkFlags {
  capHit: boolean;
  vendored: boolean;
  agent: boolean;
  unreadable: boolean;
}

/**
 * Paths the review must not read, decided BEFORE any file content is opened.
 *
 * Two sources feed one flat set of relative paths:
 *   - `.ls/policy.yaml` `ignorePaths`, the person's own exclusions. Semantics
 *     unchanged: a path itself and anything under it, matched as the report's
 *     governance layer always matched it.
 *   - `.gitignore`, honoured through real Git and turned into the same shape by
 *     the caller (see checkGitIgnore below). Git owns the pattern language;
 *     nothing here re-implements it.
 *   - `.ignore`, a documented subset parsed by the caller (see readIgnoreFiles).
 *
 * A walk skip for one of these is a fact about intent (the repo or the person
 * said not to read it), so the report's wording differs from a cap skip, and it
 * must be disclosed by path so the scope of the review stays honest.
 */
interface WalkExclusions {
  /** Path -> source word naming why it was skipped ("gitignore" | ".ls policy"). */
  ignorePaths: ReadonlyMap<string, string>;
  ignorePrefixes: ReadonlySet<string>;
}

/**
 * An ignored path is excluded when it is the path itself (a file or a
 * directory named exactly), or when it sits under an excluded directory.
 * This mirrors `isIgnoredBy` in the governance layer, so the pre-read
 * exclusion and the post-read suppression always agree on what was ignored.
 */
function isExcludedBy(exclusions: WalkExclusions, path: string): boolean {
  if (exclusions.ignorePaths.has(path)) return true;
  const parts = path.split("/");
  for (let at = 1; at < parts.length; at++) {
    if (exclusions.ignorePaths.has(parts.slice(0, at).join("/"))) return true;
  }
  return exclusions.ignorePrefixes.has(path);
}

function exclusionReason(exclusions: WalkExclusions, path: string): string {
  if (exclusions.ignorePrefixes.has(path)) return "Ignored by .ignore (the documented subset). Not read.";
  const source = exclusions.ignorePaths.get(path) ?? exclusions.ignorePaths.get(excludedScope(exclusions, path));
  if (source === undefined) return "Ignored by .ls/policy.yaml. Not read. The path is excluded as the policy names it.";
  if (source === "gitignore") return "Ignored by .gitignore. Not read. The path is excluded by the repo's own Git rules.";
  if (source.startsWith("policy:")) return `Ignored by .ls/policy.yaml: ${source.slice("policy:".length)}. Not read.`;
  return "Ignored by .ls/policy.yaml. Not read. The path is excluded as the policy names it.";
}

/**
 * The scope a walk skip names. The walk's git answers arrive per FILE (`git
 * ls-files --others` expands the untracked tree file by file), so an ignored
 * directory's skip is recorded per file under it, each without following into a read: the
 * reader sees the file paths Git named, one row each, not one row
 * for the directory the pattern spoke about.
 */
function excludedScope(exclusions: WalkExclusions, path: string): string {
  const parts = path.split("/");
  for (let at = parts.length - 1; at >= 1; at--) {
    const candidate = parts.slice(0, at).join("/");
    if (exclusions.ignorePaths.has(candidate) || exclusions.ignorePrefixes.has(candidate)) return candidate;
  }
  return path;
}

function walk(
  root: string,
  agentReadAllowed: boolean,
  rootFd: number,
  exclusions: WalkExclusions,
  flags: WalkFlags = { capHit: false, vendored: false, agent: false, unreadable: false },
): { files: ReviewFile[]; skipped: NotChecked[]; flags: WalkFlags } {
  const files: ReviewFile[] = [];
  const skipped: NotChecked[] = [];
  let bytes = 0;

  function visit(dir: string, expected?: { dev: number; ino: number }, source = dir): void {
    let names: string[] = [];
    let directoryFd: number | undefined;
    let handlePath: string;
    try {
      const listed = expected ?? lstatSync(source);
      directoryFd = openSync(source, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW);
      const opened = fstatSync(directoryFd);
      if (!opened.isDirectory() || opened.dev !== listed.dev || opened.ino !== listed.ino) throw new Error("Directory changed before read");
      // Pin parent directories while reading their children. A rename or link
      // replacement cannot redirect a child read to a different directory.
      handlePath = directoryHandlePath(directoryFd);
      names = readdirSync(handlePath);
    } catch {
      if (directoryFd !== undefined) closeSync(directoryFd);
      flags.unreadable = true;
      skipped.push({ scope: relative(root, dir).split("\\").join("/") || "(repo)", reason: "The directory could not be read." });
      return;
    }
    try {
    for (const name of names) {
      const skippedScope = relative(root, join(dir, name)).split("\\").join("/");
      // Exclusions are resolved BEFORE anything at this name is opened. A file
      // named by the policy is skipped from its lstat; a directory named by the
      // policy is skipped from being listed or descended at all, so no byte
      // under it is read.
      if (skippedScope !== "" && isExcludedBy(exclusions, skippedScope)) {
        skipped.push({ scope: excludedScope(exclusions, skippedScope), reason: exclusionReason(exclusions, skippedScope) });
        continue;
      }
      if (SKIP.has(name)) {
        const scope = skippedScope;
        if (VENDORED.has(name)) {
          flags.vendored = true;
          skipped.push({ scope, reason: "Vendored tree was not read, so its notices were not checked." });
        } else if (PACKAGE_CACHES.has(name)) {
          skipped.push({
            scope,
            reason:
              "Installed packages or a tool cache. Not read, because it holds downloaded library files, not this project's code.",
          });
        } else if (name === ".progress") {
          skipped.push({ scope, reason: "Working notes folder. Not read, and its contents are not the repo owner's to review." });
        } else if (name === ".ls") {
          skipped.push({ scope, reason: "The review's own state folder. The policy was read before the walk; the reports stay the run's record. Not read as repo files." });
        } else {
          skipped.push({ scope, reason: `Skipped directory ${name} was not read, so its notices were not checked.` });
        }
        continue;
      }
      const full = join(dir, name);
      const diskPath = join(handlePath, name);
      let info;
      try {
        info = lstatSync(diskPath);
      } catch {
        flags.unreadable = true;
        skipped.push({
          scope: relative(root, full).split("\\").join("/"),
          reason: "The entry could not be read, so it was not checked.",
        });
        continue;
      }
      if (info.isSymbolicLink()) {
        flags.unreadable = true;
        skipped.push({ scope: relative(root, full).split("\\").join("/"), reason: "Symbolic link. Not followed or read." });
        continue;
      }
      if (info.isDirectory()) {
        visit(full, info, diskPath);
        continue;
      }
      if (!info.isFile()) continue;
      const path = relative(root, full).split("\\").join("/");
      // A git-ignored or .ignore-subset-ignored file is not read. Git decided
      // the set before the walk began; nothing here re-tests the pattern.
      if (isExcludedBy(exclusions, path)) {
        skipped.push({ scope: excludedScope(exclusions, path), reason: exclusionReason(exclusions, path) });
        continue;
      }
      // An agent instruction file is read only when the person acknowledged the
      // expanded local read for the wording in force now. Refused or stale means
      // it is disclosed as not checked, the same as any other unread file.
      if (!agentReadAllowed && AGENT_FILES.has(name)) {
        flags.agent = true;
        skipped.push({
          scope: path,
          reason: "Agent instruction file. Not read: the local file read was not acknowledged for the current wording.",
        });
        continue;
      }
      const ext = name.includes(".") ? name.slice(name.lastIndexOf(".") + 1).toLowerCase() : "";
      if (BINARY.has(ext)) {
        skipped.push({ scope: path, reason: "Binary or media file." });
        continue;
      }
      if (files.length >= MAX_FILES || info.size > MAX_BYTES - bytes) {
        flags.capHit = true;
        skipped.push({ scope: path, reason: "Past the local read cap. Listed as not checked." });
        continue;
      }
      if (info.size > FILE_CAP && !name.endsWith("-lock.json") && name !== "package-lock.json") {
        flags.capHit = true;
        skipped.push({ scope: path, reason: "Larger than 100KB. Not read." });
        continue;
      }
      let fd: number | undefined;
      try {
        // Do not follow a file link introduced after the directory listing.
        // Re-check the opened object before allocating or reading its bytes.
        fd = openSync(diskPath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
        const opened = fstatSync(fd);
        if (!opened.isFile() || opened.dev !== info.dev || opened.ino !== info.ino) throw new Error("Entry changed before read");
        const lockfile = name.endsWith("-lock.json") || name === "package-lock.json";
        if (opened.size > MAX_BYTES - bytes || (!lockfile && opened.size > FILE_CAP)) {
          flags.capHit = true;
          skipped.push({ scope: path, reason: "Past the local byte budget. Not read." });
          continue;
        }
        const buffer = Buffer.alloc(opened.size);
        let count = 0;
        while (count < buffer.length) {
          const read = readSync(fd, buffer, count, buffer.length - count, null);
          if (read === 0) break;
          count += read;
          bytes += read;
        }
        const after = fstatSync(fd);
        if (count !== opened.size || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs) throw new Error("File changed during read");
        const content = buffer.toString("utf8");
        if (content.includes("\u0000")) {
          skipped.push({ scope: path, reason: "Binary content." });
          continue;
        }
        files.push({ path, content });
      } catch {
        flags.unreadable = true;
        skipped.push({ scope: path, reason: "The file could not be read as text." });
      } finally {
        if (fd !== undefined) closeSync(fd);
      }
    }
    } finally {
      closeSync(directoryFd);
    }
  }

  visit(root, fstatSync(rootFd), `${directoryHandlePath(rootFd)}/.`);
  return { files, skipped, flags };
}

function rankLockPackages(packages: LockPackage[]): LockPackage[] {
  return [...packages].sort((a, b) => {
    if (a.dev !== b.dev) return a.dev ? 1 : -1;
    if (a.depth !== b.depth) return a.depth === "direct" ? -1 : 1;
    return a.name.localeCompare(b.name);
  });
}

/**
 * Query the advisory service for the lockfile versions, or return null.
 *
 * Returning null covers three different situations and the report has to tell
 * them apart, because "we had a lockfile and did not check it" is a weaker
 * claim than "there was no lockfile to check". A caller that knows a lockfile
 * was in hand passes it in, so the not-checked line can say the exact number of
 * versions that went unchecked instead of a bare "not queried".
 */
async function queryLockAdvisories(inventory: LockInventory | null, offline: boolean): Promise<AdvisoryCoverage | null> {
  if (offline || inventory === null || !inventory.complete) return null;
  const unique = new Map<string, LockPackage>();
  for (const pkg of rankLockPackages(inventory.packages)) {
    const key = `${pkg.name}@${pkg.version}`;
    if (!unique.has(key)) unique.set(key, pkg);
  }
  const all = [...unique.values()];
  const queried = all.slice(0, OSV_CAP);
  const batch = await queryOsvBatch(queried.map((pkg) => ({ ecosystem: "npm", name: pkg.name, version: pkg.version })));
  const hits: AdvisoryCoverage["hits"] = [];
  let unanswered = 0;
  let unreadable = 0;
  queried.forEach((pkg, index) => {
    const answer = batch.results[index];
    // A coordinate with no readable answer is counted, never treated as a
    // clean coordinate. A short result list leaves the tail undefined here.
    if (answer === undefined || !answer.answered) {
      unanswered++;
      return;
    }
    unreadable += answer.unreadable;
    for (const vuln of answer.vulns) {
      hits.push({
        name: pkg.name,
        version: pkg.version,
        depth: pkg.depth,
        id: vuln.id,
        summary: vuln.summary,
        severity: vuln.severity,
      });
    }
  });
  return {
    hits,
    queried: queried.length,
    skipped: all.length - queried.length,
    timedOut: batch.timedOut,
    unanswered,
    unreadable,
  };
}

function directNames(files: ReviewFile[]): Set<string> {
  return new Set(parseManifests(files).deps.filter((dep) => dep.ecosystem === "npm").map((dep) => dep.name));
}

async function maybeRank(report: ReviewReport): Promise<void> {
  const rankable: RankableFinding[] = report.findings.map((item) => ({
    fingerprint: item.fingerprint,
    severity: item.severity,
    ruleId: item.ruleId,
    title: item.title,
  }));
  if (!laneCanReorder(rankable)) return;
  const questions: Record<string, DecisionQuestion> = {};
  for (const item of findingsToAsk(rankable)) {
    questions[questionIdFor(item.fingerprint)] = {
      type: "noul",
      instructions: `Does this need fixing before the builder shares their repo: ${item.title} (severity ${item.severity}).`,
      criteria: {
        true: "A stranger could be harmed or embarrassed if this ships as it is.",
        false: "Real, but not something to fix before sharing.",
      },
    };
  }
  const result = await decide(rankState(rankable), questions);
  if (!result.ok) return;
  const ranked = rankFromAnswers(rankable, result.answers, result.source);
  const promptsIn: PromptFinding[] = report.findings.map((item) => ({
    ruleId: item.ruleId,
    fingerprint: item.fingerprint,
    path: item.path,
    line: item.line,
    severity: item.severity,
    title: item.title,
    why: item.why,
  }));
  const top = buildTopPrompt(promptsIn, buildFixPlan(report.findings).steps, [], 3, ranked.order);
  report.orderSource = ranked.source;
  report.orderNote = ranked.note;
  report.orderMoved = ranked.moved;
  report.laneAnswered = ranked.laneAnswered;
  report.lead = top.lead?.prompt ?? report.lead;
  report.prompts = top.prompts
    .filter((item) => item.ruleId !== top.lead?.ruleId)
    .slice(0, 2)
    .map((item) => item.prompt);
}

async function maybeQuote(report: ReviewReport): Promise<{ id: string; quote: string } | null> {
  const options = suggestionOptions(report);
  if (options === null) return null;
  const result = await decide({ unknown: true }, {
    unknownNext: {
      type: "choice",
      instructions: "Which next look should be quoted for this unknown gap? Do not name a license or a finding.",
      criteria: options,
    },
  });
  if (!result.ok || result.answers === null) return null;
  const answer = result.answers["unknownNext"];
  if (answer === undefined || answer.type !== "choice") return null;
  const quote = quoteForChoice(answer.choice, options);
  if (quote === null) return null;
  return { id: answer.choice, quote };
}

// Why the usage counts were or were not sent. Closed labels only: no free text,
// no paths, no PII. Carried on --json next to the boolean.
type DiagnosticsReason =
  | "sent"
  | "not-opted-in"
  | "offline"
  | "api-url-missing"
  | "payload-refused"
  | "send-failed"
  | "not-stored";

async function sendDiagnostics(
  report: ReviewReport,
  config: LocalConfig,
  started: number,
  suggestionId: string | null,
  gov: GovOutcome,
  offline: boolean,
): Promise<{ sent: boolean; reason: DiagnosticsReason }> {
  const allowed = diagnosticsAllowed(config);
  // The consent gate is stated first, so an offline run that was also never
  // opted in reads as its own refusal and not as an offline story. Offline is
  // an additional refusal after consent, never a widening of what may be sent.
  if (!allowed) return { sent: false, reason: "not-opted-in" };
  // An offline run makes no outbound request of any kind, including this one.
  // The check sits here, inside sendDiagnostics and before any fetch, so the
  // guard cannot be missed by a future caller.
  if (offline) return { sent: false, reason: "offline" };
  const counts: Record<string, number> = {};
  for (const item of report.findings) counts[item.ruleId] = (counts[item.ruleId] ?? 0) + 1;
  if (suggestionId !== null) counts[`suggest.${suggestionId}`] = 1;
  const payload = diagnosticPayload({
    stage: "alpha",
    tier: config.tier === "pro" ? "pro" : "alpha",
    harness: config.harness ?? "local",
    version: "alpha",
    durationMs: Date.now() - started,
    orderSource: report.orderSource,
    orderMoved: report.orderMoved,
    laneAnswered: report.laneAnswered,
    suggestionSource: report.licenseSuggestion.source,
    ruleCounts: counts,
    govDetected: gov.detected,
    govRefused: gov.refused,
    govStale: gov.stale,
    govSuppressedFingerprint: gov.suppressedFingerprint,
    govSuppressedRulePath: gov.suppressedRulePath,
    govSuppressedRule: gov.suppressedRule,
    govIgnored: gov.ignored,
    govSandbag: gov.sandbag,
  });
  if (payload === null) return { sent: false, reason: "payload-refused" };
  const base = process.env["LAUNCHSENSE_API_URL"];
  if (base === undefined || base.length === 0) return { sent: false, reason: "api-url-missing" };
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/api/mcp/usage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (response.status !== 200) return { sent: false, reason: "send-failed" };
    // The route reports whether the row was actually stored. A 200 with
    // stored:false means the counts were refused, and the review must not tell
    // the person they were sent when nothing was written.
    const body = (await response.json().catch(() => null)) as { stored?: unknown } | null;
    return body !== null && body["stored"] === true
      ? { sent: true, reason: "sent" }
      : { sent: false, reason: "not-stored" };
  } catch {
    return { sent: false, reason: "send-failed" };
  }
}

function render(
  report: ReviewReport,
  diagnostics: { sent: boolean; reason: string } | null,
  quote: string | null,
): string {
  const lines: string[] = [];
  // 1. One line on what this is and what to do next.
  lines.push("LaunchSense review. The job ran on the files on this machine.");
  // What was reviewed: the whole tree, or a named change range.
  lines.push(report.scopeNote);
  lines.push(report.coverageNote);
  // The completeness line, right after coverage. It is computed from explicit
  // facts, not inferred from the skip count, and it names each reason in words.
  lines.push(report.statusNote);
  lines.push("");
  // 2. The solution, first. The lead prompt, then the next prompts to paste.
  lines.push("START HERE");
  lines.push(report.lead);
  for (const prompt of report.prompts) lines.push(prompt);
  lines.push("");
  // 3. The plan: what to do, in order, with the files and a short checklist.
  if (report.plan.length > 0) {
    lines.push("PLAN");
    for (const step of report.plan) {
      lines.push(`${step.order}. ${step.title}`);
      lines.push(`   Why: ${step.why}`);
      const files = step.files.slice(0, 5);
      if (files.length > 0) {
        lines.push(`   Files: ${files.join(", ")}${step.files.length > files.length ? `, and ${step.files.length - files.length} more` : ""}`);
      }
      for (const item of step.checklist) lines.push(`   - ${item}`);
    }
    lines.push("");
  }
  // 4. Everything else: the detail behind the plan.
  lines.push("DETAIL");
  lines.push(`Checks: fixed rules. No model decides a finding or a severity.`);
  lines.push(`Order source: ${report.orderSource}. Model moved ${report.orderMoved} item(s) inside a severity band. ${report.orderNote}`);
  // Governance disclosures. These are info rows, so the plan and prompt builders
  // leave them out. They are printed here so the text report and the JSON carry
  // the same disclosure.
  for (const finding of report.findings) {
    if (finding.ruleId === "governance.acceptance-added") {
      lines.push(`${finding.title}. ${finding.why}`);
    }
  }
  if (quote !== null) {
    lines.push(`Suggestion, quoted from the model: "${quote}" This quote is not a finding.`);
  }
  lines.push(report.lockNote);
  if (report.sbom !== null) {
    lines.push(`SBOM from ${report.sbom.tool}: ${report.sbom.components} components. Omissions: ${report.sbom.omissions.join("; ")}.`);
  }
  if (report.licenseDeclaration !== null) {
    const declaration = report.licenseDeclaration;
    lines.push(
      `Third-party licence declaration: ${declaration.components} components, ${declaration.unknown} unknown. ${declaration.note}`,
    );
    // The notice text is a file the builder can commit. It is written to its own
    // file next to the report, and only referenced here, so the report body does
    // not carry a hundred lines of it.
    lines.push(`The full third-party notice is in ${declaration.noticeFilename}, next to this report.`);
  }
  if (report.notChecked.length > 0) {
    lines.push("Not checked:");
    for (const item of report.notChecked) lines.push(`- ${item.scope}: ${item.reason}`);
  }
  lines.push(`Licence suggestion: ${report.licenseSuggestion.pick ?? "none"} (source: ${report.licenseSuggestion.source}). ${report.licenseSuggestion.note}`);
  // Each line means exactly one thing, and the line is emitted only when the
  // run's own decision is known. "null" is the saved copy, which is written
  // before the send is decided, so it asserts nothing at all. "sent" means the
  // counts reached the endpoint. "not-opted-in" is the consent answer and only
  // the consent answer. "offline" is the offline refusal. Every other reason is
  // an opted-in run whose send did not complete, which reads as its own line so
  // the bare consent line keeps its one meaning.
  if (diagnostics !== null) {
    if (diagnostics.reason === "sent") {
      lines.push("Usage counts were sent. No file text was included.");
    } else if (diagnostics.reason === "offline") {
      lines.push("Usage counts were not sent: this run was offline.");
    } else if (diagnostics.reason === "not-opted-in") {
      lines.push("Usage counts were not sent.");
    } else {
      lines.push("Usage counts were not sent: the send did not complete.");
    }
  }
  return lines.join("\n");
}

async function main(): Promise<void> {
  const started = Date.now();
  const requestedRoot = argRoot();
  // A linked root or ancestor would bypass all walker exclusions. Refuse it
  // before Git, governance reads, analysis, or local report writes.
  const { fd: rootFd } = openReviewRoot(requestedRoot);
  // Use the pinned root for Git and local metadata too. A later replacement of
  // its original pathname must not redirect a separate read or write.
  const root = directoryHandlePath(rootFd);
  try {
  const config = readConfig();
  const offline = process.env["LAUNCHSENSE_OFFLINE"] === "1";
  const mode = process.argv.includes("--change") ? "change" : "tree";
  // Resolved before the walk, so a folder that is not a git working tree fails
  // closed in change mode instead of producing a confident whole-tree report.
  const changeScope = mode === "change" ? resolveChangeScope(root) : null;
  const acknowledged = filesReadAcknowledged(config);
  // The repo's own governance file, `.ls/policy.yaml`, is read ONCE, before the
  // allowlist, the walk, and the analysis. The single read is shared by the
  // licence allowlist, the governance application, the saved policy copy, the
  // change-run comparison, AND the walk's ignorePaths, so every step decides
  // from the same bytes, and the walk can exclude a path before it reads one.
  // A refusal seen here is a refusal everywhere; no later step reads the file
  // again and finds a healthy one.
  const policyRead = readPolicyFile(rootFd);
  // The person's own ignorePaths move ahead of the walk: a listed path is
  // never opened. The reason the person wrote travels with the exclusion, so
  // the walk's own skip row can carry it, and the governance layer below does
  // not need to name the path a second time after the walk already skipped it.
  const policyIgnorePaths = new Map<string, string>();
  if (policyRead.kind === "ok") {
    const parsed = parseGovernance(policyRead.text);
    if (parsed.ok) {
      for (const entry of parsed.policy.ignorePaths) policyIgnorePaths.set(entry.path, entry.reason);
    }
  }
  // Git facts, once, before the walk: is this a Git tree, what does Git track,
  // and what does Git answer as ignored for the untracked candidates. Each
  // state that cannot be measured is carried, never guessed.
  const gitFacts = gitTrackedSet(root);
  const gitIgnores = computeGitIgnores(root, gitFacts);
  // The walk flags are created here, so a refusal inside readIgnoreFiles (its
  // own directory listing is often the first readdir on the pinned root) lands
  // on the same flags object the walk fills and completeness reads.
  const flags: WalkFlags = { capHit: false, vendored: false, agent: false, unreadable: false };
  // The policy's own exclusions travel into the ignore-file scan as well: a
  // directory the person excluded is refused before it is opened, and its
  // nested .ignore is never read or parsed. The walk's own policy-ignored
  // disclosure (built below from the same map) already covers each caught path.
  const ignoreRead = readIgnoreFiles(
    rootFd,
    flags,
    gitIgnores.state === "applied" ? gitIgnores.ignoredPaths : new Set(),
    new Set(policyIgnorePaths.keys()),
  );
  // One exclusion map, each entry naming its source: the policy's own
  // ignorePaths, Git's answer for the untracked candidates, and the `.ignore`
  // subset. The policy map keys can be directories, so children match through
  // isExcludedBy's parent walk; Git's set is exact (it named each path).
  const policyExclusions = new Map(
    [...policyIgnorePaths.entries()].map(([path, reason]) => [path, `policy:${reason}`]),
  );
  const gitExclusions = new Map(
    gitIgnores.state === "applied" ? [...gitIgnores.ignoredPaths].map((path) => [path, "gitignore"]) : [],
  );
  const exclusions: WalkExclusions = {
    ignorePaths: new Map([...policyExclusions, ...gitExclusions]),
    ignorePrefixes: ignoreRead.covered,
  };
  const { files, skipped } = walk(root, acknowledged, rootFd, exclusions, flags);
  const lock = files.find((file) => (file.path.split("/").pop() ?? "") === "package-lock.json");
  // Any lockfile the tree holds that was not inventoried and queried is a
  // version set that was in hand and unchecked: a Cargo.lock, a yarn.lock, or a
  // second npm lockfile in a nested project. Only the first npm lockfile is
  // inventoried.
  const isLockfile = (path: string): boolean => {
    const base = (path.split("/").pop() ?? "").toLowerCase();
    return base === "package-lock.json" || OTHER_LOCKFILES.has(base);
  };
  const unqueriedLockfileInHand = files.some(
    (file) => isLockfile(file.path) && file.path !== lock?.path,
  );
  const inventory = lock === undefined ? null : inventoryNpmLock(lock.content, directNames(files));
  const registry = offline || inventory === null
    ? null
    : await lookupPackages(inventory.packages.filter((pkg) => !pkg.dev).slice(0, 15));
  const advisories = await queryLockAdvisories(inventory, offline);
  // The repo's own allowlist. Only licence ids travel into the suggestion, never
  // file text.
  // trackedEnvPaths is Git's answer for what is tracked. Null: it could not be
  // measured, so tracked-env cannot fire and one not-checked line says so.
  const trackedEnvPaths: ReadonlySet<string> | null = gitFacts.tracked;
  const trackedEnvUnknown = trackedEnvPaths === null;
  const report = buildLocalReport(files, skipped, registry, advisories, lock, readLicenceAllow(policyRead), trackedEnvPaths);
  // Tracked-state honesty, in the not-checked list. One line for the whole
  // rule, so the gap is named once and never per-file, whatever the file count.
  if (trackedEnvUnknown) {
    report.notChecked.push({
      scope: "secret.tracked-env",
      reason:
        "Tracked status of .env files could not be judged from this folder, so the tracked-environment-file rule did not run. Unknown stays unknown.",
    });
  }
  // The Git ignore source, when it could not be applied. A not-git folder is an
  // ordinary disclosed state, not an error; a Git failure inside a tree is a
  // refusal, and the paths that might be ignored were read, which is why that
  // must be stated, not left silent.
  if (gitIgnores.state === "failed") {
    report.notChecked.push({
      scope: ".gitignore",
      reason:
        "git could not answer which paths are ignored, so the .gitignore exclusions were not applied and paths that might be ignored were not excluded. Nothing was invented on Git's behalf.",
    });
  } else if (gitIgnores.state === "not_a_git_tree") {
    report.notChecked.push({
      scope: ".gitignore",
      reason:
        "This folder is not a Git working tree, so .gitignore rules could not be applied and tracked status is unknown: git-ignored and untracked paths could not be distinguished from tracked ones.",
    });
  }
  for (const refusal of ignoreRead.refusals) report.notChecked.push(refusal);
  // The governance file is applied to the findings, so an accepted finding is
  // not raised again. A file that is wrong is refused whole and nothing is
  // suppressed; the refusal is disclosed rather than silently obeyed or silently
  // ignored. An absent file is ordinary; a link or an unreadable file is refused,
  // never read as absent.
  const gov = applyGovernanceFile(policyRead, report);
  // A change run scopes the findings to the diff, but the read stays whole-tree
  // so the licence, OSV, and hygiene checks keep their context and do not emit
  // false "not found" lines. Dependency findings ride with a changed manifest or
  // lockfile, because their path is a package name, not a file in the diff.
  if (changeScope !== null) {
    report.scopeNote = changeScope.note;
    // The changed file is the scope. A dependency finding's path is a package
    // name, not a file in the diff, so it is admitted when the inventoried
    // lockfile changed. deps.install-script already carries a manifest path and
    // is scoped by path. A repo-level finding is admitted only when the deletion
    // that causes it is in the change.
    const inventoriedLockChanged = lock !== undefined && changeScope.changed.has(lock.path);
    const manifestChanged = [...changeScope.changed].some((path) =>
      MANIFEST_FILES.has((path.split("/").pop() ?? "").toLowerCase()),
    );
    // license.policy is admitted when its own path is a changed file (handled
    // above by changeScope.changed), when a changed manifest's declared licence
    // actually changed, or when the licence file it names was deleted. A changed
    // NOTICE or a sibling licence file does not admit an unchanged licence
    // file's finding.
    let licenceSignalChanged = false;
    if (manifestChanged) {
      for (const path of changeScope.changed) {
        const base = (path.split("/").pop() ?? "").toLowerCase();
        if (!MANIFEST_FILES.has(base)) continue;
        const current = files.find((file) => file.path === path);
        const baseShow = git(root, ["show", `${changeScope.basePoint}:${path}`]);
        if (current === undefined || !baseShow.ok) {
          licenceSignalChanged = true;
          break;
        }
        if (manifestLicenceToken(current.content, base) !== manifestLicenceToken(baseShow.out, base)) {
          licenceSignalChanged = true;
          break;
        }
      }
    }
    const deletedReadme = [...changeScope.deleted].some((path) =>
      README_FILE.test(path.split("/").pop() ?? ""),
    );
    const deletedLicence = [...changeScope.deleted].some((path) =>
      LICENCE_FILE.test(path.split("/").pop() ?? ""),
    );
    report.findings = report.findings.filter((finding) => {
      if (changeScope.changed.has(finding.path)) return true;
      if (
        inventoriedLockChanged &&
        finding.ruleId !== "deps.install-script" &&
        (finding.ruleId.startsWith("deps.") || finding.ruleId === "license.clash")
      ) {
        return true;
      }
      if (finding.ruleId === "license.policy" && licenceSignalChanged) {
        return true;
      }
      if (finding.path === "(repo)" && finding.ruleId.startsWith("hygiene.") && deletedReadme) {
        return true;
      }
      if (finding.path === "(repo)" && finding.ruleId.startsWith("license.") && deletedLicence) {
        return true;
      }
      return false;
    });
    // A newly added governance acceptance is a disclosure, never a block. It is
    // detected only on a change run and only here, not in extraChecks.ts, which
    // also runs on whole-tree scans.
    const acceptances = detectNewAcceptances(policyRead, rootFd);
    if (acceptances.source === "policy-unreadable") {
      report.notChecked.push({
        scope: ".ls/policy.yaml",
        reason:
          "The governance file could not be read, so a newly added acceptance could not be checked against a prior copy. Nothing was compared.",
      });
    } else if (acceptances.source === "no-prior-copy") {
      report.notChecked.push({
        scope: ".ls/policy.yaml",
        reason:
          "A governance file exists but there is no prior policy copy under .ls/reports, so a newly added acceptance cannot be claimed. Nothing was compared.",
      });
    } else if (
      acceptances.source === "prior-unreadable" ||
      acceptances.source === "prior-refused" ||
      acceptances.source === "reports-unreadable"
    ) {
      report.notChecked.push({
        scope: ".ls/policy.yaml",
        reason: `The prior policy copy ${acceptances.priorName ?? "under .ls/reports"} could not be read, so a newly added acceptance could not be checked. Nothing was compared.`,
      });
    } else if (acceptances.source === "ls-unreachable") {
      report.notChecked.push({
        scope: ".ls/policy.yaml",
        reason: `${acceptances.note ?? "The .ls folder could not be opened for the comparison."} No newly added acceptance could be checked. Nothing was compared.`,
      });
    } else if (acceptances.source !== "none") {
      const rows = acceptanceFindings(acceptances.rows, acceptances.source);
      if (rows.length > 0) report.findings.push(...rows);
      // State which source was used, whether or not a row was found.
      report.scopeNote = `${report.scopeNote} Governance acceptances compared against ${acceptances.source}.`;
    }
    // The plan, lead, and prompts were built from the whole tree, so they are
    // rebuilt from the scoped findings or the report would recommend fixes it
    // no longer lists.
    refreshDerivations(report);
  }
  // Completeness is computed here, after governance, from explicit facts and
  // never from the length of the skipped list. A check that does not apply to
  // this repo (npm on a repo with no package.json and no lockfile) is not a
  // reason; a check that applies and did not run is. The two doors agree, and
  // the harness reads the report body and JSON, not an exit code.
  // npm checks apply when npm dependencies are actually declared, or when an
  // npm lockfile is in hand. A package.json with no dependencies has nothing
  // for those checks to run, so it is "not applicable", not "not run".
  const declaresNpmDeps = directNames(files).size > 0;
  // The scan already ran once inside buildLocalReport, and the report carries
  // its omission facts. Reusing them here means one scan per run and one
  // source of truth for both doors of the report.
  const omissions = report.analyzerOmissions;
  const completeness = completenessFor({
    capHit: flags.capHit,
    vendored: flags.vendored,
    agent: flags.agent,
    unreadable: flags.unreadable,
    govRefused: gov.refused !== "none",
    govStale: gov.stale,
    npmApplicable: declaresNpmDeps || inventory !== null,
    unqueriedLockfileInHand,
    lockfileInHand: inventory !== null,
    inventoryComplete: inventory === null ? null : inventory.complete,
    advisoriesQueried: advisories !== null,
    advisoriesTimedOut: advisories?.timedOut ?? false,
    advisoriesSkipped: advisories?.skipped ?? 0,
    advisoriesUnanswered: advisories?.unanswered ?? 0,
    advisoriesUnreadable: advisories?.unreadable ?? 0,
    registryQueried: registry !== null,
    analyzerSkippedLines: omissions?.longLines ?? 0,
    analyzerCodeSkippedLines: omissions?.codeSkippedLines ?? 0,
    analyzerSuppressedMatches: omissions?.suppressedMatches ?? 0,
  });
  report.status = completeness.status;
  report.statusNote = completeness.note;
  // Offline with a complete lockfile in hand: the inventory says how many exact
  // versions were available to check and none of them were. Say so here, in the
  // caller's own words, rather than leaving the flat "not queried" line to imply
  // there was nothing to query. The line is added, never replaces, so the
  // report still carries its own not-checked entry for the same gap.
  if (offline && inventory !== null && inventory.complete && inventory.packages.length > 0) {
    report.lockNote =
      `${inventory.note} This run was offline, so no version in that lockfile was checked against the advisory service. ` +
      "A lockfile in hand that was never queried is unknown, not a pass.";
  }
  if (!offline) {
    const pkg = files.find((file) => file.path === "package.json");
    const repo = pkg?.content.match(/github\.com\/([A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+)/)?.[1];
    if (repo !== undefined) {
      const fact = await scorecardFact(`github.com/${repo}`);
      if (fact !== null) report.notChecked.push({ scope: "scorecard", reason: fact });
    }
    await maybeRank(report);
  }
  // The repo's own copy of the report, written only after completeness is known
  // and after every fallible side file has been attempted, so the saved copy and
  // the terminal report state the same status, findings, and gaps.
  //
  // F27: a side-file failure is marked BEFORE the markdown is written, so the
  // saved copy and the terminal report carry the same failure. A failure to write
  // the markdown itself is marked AFTER, so it appears in the terminal report only
  // and no saved copy is left that reads as the new current one. What the saved
  // copy and the terminal output share is the status, the findings, and the
  // not-checked gaps, not every byte: the saved copy is rendered without the
  // usage-count line and the model quote, which are added to the terminal output
  // afterwards and are not facts about the review.
  const localState = prepareLocalState(rootFd, report, acknowledged, policyRead);
  if (localState.failed) {
    markLocalStateFailure(report, "the local report copy could not be fully written");
  }
  if (localState.reportsFd !== null) {
    const reportsFd = localState.reportsFd;
    try {
      if (writeSavedReport(reportsFd, report)) {
        // There is no saved copy on this path, so this gap is added to the
        // terminal report only. It is a gap, not a silent failure: the saved
        // report was not written and that is stated.
        report.notChecked.push({ scope: ".ls/reports", reason: "The report copy was not written, so no saved copy of this run exists. Read this report from the tool output." });
        markLocalStateFailure(report, "the report copy could not be written");
      }
    } finally {
      closeSync(reportsFd);
    }
  }
  const quoted = offline ? null : await maybeQuote(report);
  const sent = await sendDiagnostics(report, config, started, quoted?.id ?? null, gov, offline);
  const isJson = process.argv.includes("--json");
  if (isJson) {
    // One JSON document per line, terminated. Piping this into jq or a file
    // needs the last line to have a terminator like any other line.
    process.stdout.write(
      `${JSON.stringify({ ...report, diagnosticsSent: sent.sent, diagnosticsReason: sent.reason, modelQuote: quoted?.quote ?? null })}\n`,
    );
  } else {
    process.stdout.write(`${render(report, sent, quoted?.quote ?? null)}\n`);
  }
  // The exit code is for the direct CLI path only. Over MCP the same facts
  // arrive as report text, so a review that ran is exit 0 and isError is
  // reserved for a review that could not run at all. The MCP runner passes
  // --mcp for that reason. Default is 2 on any incomplete run, because exit 0
  // on a partial re-teaches that incomplete is fine. --lenient downgrades that
  // to 0 with a warning, except for a cap hit or a lockfile in hand that was
  // never queried, which never return 0.
  const mcpMode = process.argv.includes("--mcp");
  if (!mcpMode && report.status === "partial") {
    const neverLenient = flags.capHit || unqueriedLockfileInHand || (inventory !== null && advisories === null);
    if (process.argv.includes("--lenient") && !neverLenient) {
      process.stderr.write("Review incomplete, reported as a warning.\n");
    } else {
      process.exitCode = 2;
    }
  }
  } finally {
    closeSync(rootFd);
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "The review failed.";
  process.stderr.write(message);
  process.exitCode = 1;
});
