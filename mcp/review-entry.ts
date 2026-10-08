// Local review entry. Reads the working tree. Does not call api.github.com.
// Alpha does not check an API key. The auth slot is recorded and not enforced.

import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, relative } from "node:path";
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
function applyGovernanceFile(root: string, report: ReviewReport): GovOutcome {
  const outcome: GovOutcome = emptyGovOutcome();
  const path = join(root, ".ls", "policy.yaml");
  let text: string;
  try {
    if (!existsSync(path)) return outcome;
    text = readFileSync(path, "utf8");
  } catch {
    report.notChecked.push({ scope: ".ls/policy.yaml", reason: "A governance file exists but could not be read. Nothing was suppressed." });
    outcome.detected = true;
    outcome.refused = "unreadable";
    return outcome;
  }

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

  if (policy.ignorePaths.length > 0) {
    for (const entry of policy.ignorePaths) {
      report.notChecked.push({ scope: entry.path, reason: `Ignored by .ls/policy.yaml: ${entry.reason}` });
    }
  }
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
 * Write the timestamped copy of the report under `.ls/reports/`, next to the
 * policy, plus the third-party notice when there is one. Written only when the
 * expanded local read is acknowledged, because it is a file the review writes.
 * Called after completeness runs, so the copy and the terminal report agree.
 */
function writeLocalReportCopy(root: string, report: ReviewReport, acknowledged: boolean): void {
  if (!acknowledged) return;
  try {
    const stamp = new Date().toISOString().replace(/[:.]/g, "-");
    const dir = join(root, ".ls", "reports");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${stamp}.md`), render(report, false, null), "utf8");
    // The third-party notice is its own file, so the report body stays a report
    // and the notice stays a document the person can commit. Same one per run.
    if (report.licenseDeclaration !== null) {
      const noticeName = report.licenseDeclaration.noticeFilename.replace(/[^\w.-]/g, "-");
      writeFileSync(join(dir, `${stamp}-${noticeName}`), report.licenseDeclaration.notice, "utf8");
    }
    // Keep a copy of the governance file next to the report, so the next change
    // run can diff a newly added acceptance against it. .ls/ is gitignored, so
    // this copy is the only prior record of the policy. When no policy exists,
    // an empty one is recorded, so a later run is never compared against a
    // stale copy from before the file was absent.
    const policyPath = join(root, ".ls", "policy.yaml");
    const policyCopy = existsSync(policyPath) ? readFileSync(policyPath, "utf8") : "version: 1\naccepts: []\n";
    writeFileSync(join(dir, `${stamp}.policy.yaml`), policyCopy, "utf8");
    ensureGitignored(root);
  } catch {
    report.notChecked.push({ scope: ".ls/reports", reason: "The report copy could not be written." });
  }
}

/**
 * Keep `.ls/` out of git. The folder is the repo's private memory: the findings
 * a person accepted and the reports they ran. It stays on the machine, so the
 * first time the review writes it, it adds one line to `.gitignore` if the line
 * is not already there. A repo that deliberately commits the file removes the
 * line; that is a choice a person makes, not a default.
 */
function ensureGitignored(root: string): void {
  const path = join(root, ".gitignore");
  try {
    const current = existsSync(path) ? readFileSync(path, "utf8") : "";
    const present = current
      .split("\n")
      .some((line) => [".ls/", "/.ls/", ".ls", "/.ls"].includes(line.trim()));
    if (present) return;
    const body = current.length > 0 && !current.endsWith("\n") ? `${current}\n` : current;
    writeFileSync(path, `${body}\n# LaunchSense governance. Kept on this machine only.\n.ls/\n`, "utf8");
  } catch {
    // Not fatal. The policy and the report are still written; a repo without a
    // writable .gitignore is the person's own arrangement.
  }
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
 * The acceptances added to `.ls/policy.yaml` since the last report. `.ls/` is
 * gitignored, so a git change list never sees it: this reads the file directly
 * and diffs it against the newest policy copy under `.ls/reports/`. It returns
 * which source it used. With no prior copy it claims nothing, rather than
 * calling every acceptance new. Disclosure only.
 */
function detectNewAcceptances(root: string): { rows: GovAccept[]; source: string; priorName: string | null } {
  const policyPath = join(root, ".ls", "policy.yaml");
  if (!existsSync(policyPath)) return { rows: [], source: "none", priorName: null };
  let text: string;
  try {
    text = readFileSync(policyPath, "utf8");
  } catch {
    return { rows: [], source: "none", priorName: null };
  }
  const parsed = parseGovernance(text);
  if (!parsed.ok || parsed.policy.accepts.length === 0) return { rows: [], source: "none", priorName: null };
  const dir = join(root, ".ls", "reports");
  let priorNames: string[] = [];
  try {
    priorNames = readdirSync(dir).filter((name) => name.endsWith(".policy.yaml")).sort();
  } catch {
    priorNames = [];
  }
  const priorName = priorNames.length > 0 ? priorNames[priorNames.length - 1] : null;
  if (priorName === null) return { rows: [], source: "no-prior-copy", priorName: null };
  let priorText: string;
  try {
    priorText = readFileSync(join(dir, priorName), "utf8");
  } catch {
    return { rows: [], source: "prior-unreadable", priorName };
  }
  const priorParsed = parseGovernance(priorText);
  if (!priorParsed.ok) return { rows: [], source: "prior-refused", priorName };
  const priorKeys = new Set(priorParsed.policy.accepts.map(acceptKey));
  return {
    rows: parsed.policy.accepts.filter((accept) => !priorKeys.has(acceptKey(accept))),
    source: priorName,
    priorName,
  };
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
function git(root: string, args: string[]): { ok: boolean; out: string } {
  try {
    const out = execFileSync("git", ["-C", root, ...args], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
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
      stdio: ["ignore", "pipe", "ignore"],
    });
    const entries = out.split("\u0000").filter((entry) => entry !== "");
    return { ok: true, entries };
  } catch {
    return { ok: false, entries: [] };
  }
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
 * licence ids come back, so no other field of the file is read here.
 */
function readLicenceAllow(root: string): string[] {
  const path = join(root, ".ls", "policy.yaml");
  try {
    if (!existsSync(path)) return [];
    const parsed = parseGovernance(readFileSync(path, "utf8"));
    return parsed.ok ? parsed.policy.licenceAllow : [];
  } catch {
    return [];
  }
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

function walk(
  root: string,
  agentReadAllowed: boolean,
): { files: ReviewFile[]; skipped: NotChecked[]; flags: WalkFlags } {
  const files: ReviewFile[] = [];
  const skipped: NotChecked[] = [];
  const flags: WalkFlags = { capHit: false, vendored: false, agent: false, unreadable: false };
  let bytes = 0;

  function visit(dir: string): void {
    let names: string[] = [];
    try {
      names = readdirSync(dir);
    } catch {
      flags.unreadable = true;
      skipped.push({ scope: relative(root, dir) || dir, reason: "The directory could not be read." });
      return;
    }
    for (const name of names) {
      if (SKIP.has(name)) {
        const scope = relative(root, join(dir, name)).split("\\").join("/");
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
        } else {
          skipped.push({ scope, reason: `Skipped directory ${name} was not read, so its notices were not checked.` });
        }
        continue;
      }
      const full = join(dir, name);
      let info;
      try {
        info = statSync(full);
      } catch {
        flags.unreadable = true;
        skipped.push({
          scope: relative(root, full).split("\\").join("/"),
          reason: "The entry could not be read, so it was not checked.",
        });
        continue;
      }
      if (info.isDirectory()) {
        visit(full);
        continue;
      }
      if (!info.isFile()) continue;
      const path = relative(root, full).split("\\").join("/");
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
      if (files.length >= MAX_FILES || bytes >= MAX_BYTES) {
        flags.capHit = true;
        skipped.push({ scope: path, reason: "Past the local read cap. Listed as not checked." });
        continue;
      }
      if (info.size > FILE_CAP && !name.endsWith("-lock.json") && name !== "package-lock.json") {
        flags.capHit = true;
        skipped.push({ scope: path, reason: "Larger than 100KB. Not read." });
        continue;
      }
      try {
        const content = readFileSync(full, "utf8");
        if (content.includes("\u0000")) {
          skipped.push({ scope: path, reason: "Binary content." });
          continue;
        }
        files.push({ path, content });
        bytes += content.length;
      } catch {
        flags.unreadable = true;
        skipped.push({ scope: path, reason: "The file could not be read as text." });
      }
    }
  }

  visit(root);
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
  queried.forEach((pkg, index) => {
    const vulns = batch.results[index] ?? [];
    for (const vuln of vulns) {
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

async function sendDiagnostics(
  report: ReviewReport,
  config: LocalConfig,
  started: number,
  suggestionId: string | null,
  gov: GovOutcome,
): Promise<boolean> {
  if (!diagnosticsAllowed(config)) return false;
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
  if (payload === null) return false;
  const base = process.env["LAUNCHSENSE_API_URL"];
  if (base === undefined || base.length === 0) return false;
  try {
    const response = await fetch(`${base.replace(/\/$/, "")}/api/mcp/usage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(8000),
    });
    if (response.status !== 200) return false;
    // The route reports whether the row was actually stored. A 200 with
    // stored:false means the counts were refused, and the review must not tell
    // the person they were sent when nothing was written.
    const body = (await response.json().catch(() => null)) as { stored?: unknown } | null;
    return body !== null && body["stored"] === true;
  } catch {
    return false;
  }
}

function render(report: ReviewReport, diagnosticsSent: boolean, quote: string | null): string {
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
  lines.push(diagnosticsSent ? "Usage counts were sent. No file text was included." : "Usage counts were not sent.");
  return lines.join("\n");
}

async function main(): Promise<void> {
  const started = Date.now();
  const config = readConfig();
  const root = argRoot();
  const offline = process.env["LAUNCHSENSE_OFFLINE"] === "1";
  const mode = process.argv.includes("--change") ? "change" : "tree";
  // Resolved before the walk, so a folder that is not a git working tree fails
  // closed in change mode instead of producing a confident whole-tree report.
  const changeScope = mode === "change" ? resolveChangeScope(root) : null;
  const acknowledged = filesReadAcknowledged(config);
  const { files, skipped, flags } = walk(root, acknowledged);
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
  // The repo's own allowlist, read before analysis so the licence suggestion can
  // weigh it. Only licence ids travel into the suggestion, never file text.
  const report = buildLocalReport(files, skipped, registry, advisories, lock, readLicenceAllow(root));
  // The repo's own governance file, `.ls/policy.yaml`. It is read after analysis
  // and applied to the findings, so an accepted finding is not raised again. A
  // file that is wrong is refused whole and nothing is suppressed; the refusal is
  // disclosed rather than silently obeyed or silently ignored.
  const gov = applyGovernanceFile(root, report);
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
    const acceptances = detectNewAcceptances(root);
    if (acceptances.source === "no-prior-copy") {
      report.notChecked.push({
        scope: ".ls/policy.yaml",
        reason:
          "A governance file exists but there is no prior policy copy under .ls/reports, so a newly added acceptance cannot be claimed. Nothing was compared.",
      });
    } else if (acceptances.source === "prior-unreadable" || acceptances.source === "prior-refused") {
      report.notChecked.push({
        scope: ".ls/policy.yaml",
        reason: `The prior policy copy ${acceptances.priorName ?? ""} could not be read, so a newly added acceptance could not be checked. Nothing was compared.`,
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
    registryQueried: registry !== null,
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
  // The repo's own copy of the report, written only after completeness is known,
  // so the copy and the terminal report state the same status.
  writeLocalReportCopy(root, report, acknowledged);
  const quoted = offline ? null : await maybeQuote(report);
  const sent = await sendDiagnostics(report, config, started, quoted?.id ?? null, gov);
  const isJson = process.argv.includes("--json");
  if (isJson) {
    // One JSON document per line, terminated. Piping this into jq or a file
    // needs the last line to have a terminator like any other line.
    process.stdout.write(`${JSON.stringify({ ...report, diagnosticsSent: sent, modelQuote: quoted?.quote ?? null })}\n`);
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
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : "The review failed.";
  process.stderr.write(message);
  process.exitCode = 1;
});
