// Builds the harness report from files already read into memory.
// No network. Registry facts are passed in when the caller looked them up.

import { analyzeHygiene } from "../analyzers/hygiene.ts";
import { analyzeLicenses } from "../analyzers/licenses.ts";
import { parseManifests } from "../analyzers/deps.ts";
import { scanSecrets } from "../analyzers/secrets.ts";
import type { ScanOmissionFacts } from "../analyzers/secrets.ts";
import { ANALYZER_VERSION } from "../analyzers/version.ts";
import { severityForFinding } from "../policies/severity.ts";
import type { Severity } from "../policies/severity.ts";
import { fingerprintFinding, redactedSnippet } from "../redaction.ts";
import { buildFixPlan } from "../reports/fixPlan.ts";
import { tableOrder } from "../reports/priority.ts";
import type { RankableFinding } from "../reports/priority.ts";
import { buildTopPrompt } from "../reports/topPrompt.ts";
import type { PromptFinding } from "../reports/topPrompt.ts";
import { suggestProjectLicence } from "../licensing/suggest.ts";
import type { LicenceSuggestion } from "../licensing/suggest.ts";
import { clashSignal } from "./clash.ts";
import { countNamedHosts, deadCopies, generatedMarkers, modelCards, networkHints, repeatedFunctions, NETWORK_HINT_CAP } from "./extraChecks.ts";
import { inventoryNpmLock } from "./lockfile.ts";
import { noLockfileInventory, readNpmDependencyLicenses } from "../licensing/dependencies.ts";
import { buildNoticeArtifact } from "../licensing/notice.ts";
import type { LicenseSuggestion } from "../licensing/lookup.ts";
import { licenseLookupRefusal } from "../licensing/lookup.ts";

export interface ReviewFile {
  path: string;
  content: string;
}

export interface NotChecked {
  scope: string;
  reason: string;
}

export interface ReviewFinding {
  ruleId: string;
  path: string;
  line: number;
  severity: Severity;
  title: string;
  why: string;
  fingerprint: string;
}

export interface RegistryFact {
  name: string;
  version: string;
  license: string | null;
  source: "deps.dev" | "clearlydefined" | "unknown";
  note: string;
  publishedAt?: string | null;
  isDefault?: boolean;
  deprecated?: boolean | null;
  deprecatedReason?: string | null;
}

export interface AdvisoryHit {
  name: string;
  version: string;
  depth: "direct" | "transitive";
  id: string;
  summary: string;
  severity: string;
}

export interface AdvisoryCoverage {
  hits: AdvisoryHit[];
  queried: number;
  skipped: number;
  timedOut: boolean;
  /**
   * Coordinates that were sent and got no readable answer: a result list
   * shorter than the queries, a non-object entry, or an unreadable vulns field.
   * Zero is clean only together with zero `unreadable`. A missing answer is not
   * a pass, so this is never counted into a clean report.
   */
  unanswered: number;
  /**
   * Advisory records the answer named that could not be read or could not be
   * listed: a non-object, a record with no string id, or a record past the
   * per-coordinate listing cap. Counted, never dropped.
   */
  unreadable: number;
}

export interface ReviewReport {
  stage: "alpha";
  authRequired: false;
  status: "complete" | "partial";
  /**
   * The plain-words reason behind status, printed right after the coverage
   * line. It is not a second status: the single field is status, and this is
   * its explanation. The local review replaces this provisional line after
   * governance runs, because a governance refusal is not known here.
   */
  statusNote: string;
  filesRead: number;
  filesSkipped: number;
  coverageNote: string;
  /**
   * What was reviewed: the whole working tree, or a change from a named base.
   * The base is always named in change mode, never left as HEAD.
   */
  scopeNote: string;
  notChecked: NotChecked[];
  findings: ReviewFinding[];
  lead: string;
  prompts: string[];
  /** The ordered fix plan: what to do first, with files and a short checklist. */
  plan: Array<{ order: number; title: string; why: string; files: string[]; checklist: string[] }>;
  orderSource: "local" | "jev" | "perplexity" | "table";
  orderNote: string;
  /** Positions the decision lane moved inside a severity band. 0 means it changed nothing. */
  orderMoved: number;
  /** True when a rung other than the table named the order. */
  laneAnswered: boolean;
  lockNote: string;
  sbom: { tool: string; components: number; omissions: string[] } | null;
  /**
   * The declaration record, read from the npm lockfile the repo committed. Null
   * only when there is no inventory to describe. It carries the artifact text,
   * so a person can commit it without running anything else.
   */
  licenseDeclaration: LicenseDeclaration | null;
  /** The structured licence suggestion. A suggestion, never a licence fact. */
  licenseSuggestion: LicenceSuggestion;
  /**
   * Lines the fixed line-level checks skipped and matches the caps withheld,
   * as counts, from one scan pass. Null when every line was judged, so a
   * report without this field describes a read with nothing omitted rather
   * than an unknown one. `files` is every distinct file carrying at least
   * one of the three facts, whichever fact it is. The per-file detail lives
   * in the not-checked list; never line text, only counts.
   */
  analyzerOmissions: {
    files: number;
    longLines: number;
    codeSkippedLines: number;
    suppressedMatches: number;
  } | null;
}

/** What the licence lane measured, and the file it can hand the builder. */
export interface LicenseDeclaration {
  components: number;
  unknown: number;
  complete: boolean;
  note: string;
  notice: string;
  noticeFilename: string;
  notCovered: string[];
  /**
   * Always empty on this path. The guarded lookup is not configured here, so it
   * is never called, and there is nothing to record. Present so the report can
   * say the lane was refused rather than saying nothing about it.
   */
  suggestions: LicenseSuggestion[];
}

const TEXT: Record<string, { title: string; why: string }> = {
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
    title: "This line looks like a database query",
    why: "The line matches SELECT ... FROM. That does not prove injection.",
  },
  "code.eval-use": {
    title: "Eval runs strings as code",
    why: "Eval turns text into code. This is the shape of a call, not proof it is reachable.",
  },
  "code.debugger-statement": {
    title: "Debugger statement left in code",
    why: "A debugger statement can freeze the app for anyone who opens it.",
  },
  "code.debug-leftover": {
    title: "Debug output left in source",
    why: "Console output can leak internals. This is one hit per file.",
  },
  "code.sql-pattern": {
    title: "This line looks like a database query",
    why: "The line matches SELECT ... FROM. That does not prove injection.",
  },
  "code.inner-html": {
    title: "innerHTML is assigned",
    why: "Assigning innerHTML can run markup as HTML. This is a shape, not proof of an exploit.",
  },
  "code.child-process": {
    title: "Child process capability or call is present",
    why: "This rule's possible matches are a require or from import of child_process, and the execSync, execFile, and execFileSync calls. It does not identify which one this line hit. An import is a capability, not a run. execSync runs through a shell. execFile and execFileSync use no shell by default, so they only reach a shell when the caller opts in with { shell: true }. A bare exec call, a side-effect import, and a dynamic import are not matched. This is a signal, and the line was not run.",
  },
  "code.weak-crypto": {
    title: "A weak hash or cipher call is present",
    why: "This rule's possible matches are md5 or sha1 in createHash, the deprecated createCipher API with any quoted argument, and a broken name in createCipheriv such as des, des3, 3des, rc4, rc2, bf, blowfish, or ecb. A modern cipher such as aes-256-gcm is not flagged. This is not a certificate verdict.",
  },
  "code.cors-wildcard": {
    title: "A CORS wildcard is set",
    why: "A star origin allows any site to call this response. Confirm that is intended.",
  },
};

function finding(
  ruleId: string,
  path: string,
  line: number,
  title: string,
  why: string,
  raw: string,
  severityOverride?: Severity,
): ReviewFinding {
  const snippet = redactedSnippet(raw);
  return {
    ruleId,
    path,
    line,
    severity: severityOverride ?? severityForFinding(ruleId, path),
    title,
    why,
    fingerprint: fingerprintFinding(ruleId, ANALYZER_VERSION, path, snippet),
  };
}

/** Lockfiles this review reads but cannot inventory. Naming them beats claiming none was read. */
export const OTHER_LOCKFILES = new Set([
  "cargo.lock", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "gemfile.lock",
  "composer.lock", "packages.lock.json", "pipfile.lock", "mix.lock", "pubspec.lock",
  "gradle.lockfile", "go.sum", "npm-shrinkwrap.json", "uv.lock",
]);

function listNames(paths: string[]): string {
  const named = paths.map((path) => path.split("/").pop() ?? path);
  if (named.length === 1) return named[0] ?? "";
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

/**
 * The per-file rows for the not-checked list. At most ten files are listed,
 * each with the counts of what its own checks skipped; the rest are carried
 * by one count-only summary row, so the totals always name every affected
 * file while the display stays bounded. Returns null when nothing was
 * omitted, so the caller adds no row.
 */
export function analyzerOmissionRows(
  omissions: ScanOmissionFacts,
  rowsCap = 10,
): NotChecked[] | null {
  const entries = Object.keys(omissions.perFile)
    .filter((path) => {
      const facts = omissions.perFile[path];
      return facts !== undefined && (facts.longLines > 0 || facts.skippedCodeLines > 0 || facts.capSuppressed > 0);
    })
    .map((path) => [path, omissions.perFile[path]] as const);
  if (entries.length === 0) return null;
  const parts = (facts: { longLines: number; skippedCodeLines: number; capSuppressed: number }): string => {
    const reasons: string[] = [];
    if (facts.longLines > 0) {
      reasons.push(
        facts.longLines === 1
          ? `${facts.longLines} line over 2,000 characters skipped by the secret checks' 2,000-character gate`
          : `${facts.longLines} lines over 2,000 characters skipped by the secret checks' 2,000-character gate`,
      );
    }
    if (facts.skippedCodeLines > 0) {
      reasons.push(
        facts.skippedCodeLines === 1
          ? `${facts.skippedCodeLines} line over 500 characters that the code-shape checks did not judge`
          : `${facts.skippedCodeLines} lines over 500 characters that the code-shape checks did not judge`,
      );
    }
    if (facts.capSuppressed > 0) {
      reasons.push(
        facts.capSuppressed === 1
          ? `${facts.capSuppressed} further matched line past the 20-match cap was withheld`
          : `${facts.capSuppressed} further matched lines past the 20-match cap were withheld`,
      );
    }
    return reasons.join("; ") + ". Other checks may still read this file under their own limits.";
  };
  const rows: NotChecked[] = entries.slice(0, rowsCap).map(([path, facts]) => ({
    scope: path,
    reason: `Line-level caps on this file: ${parts(facts)}`,
  }));
  if (entries.length > rowsCap) {
    // Count-only summary on purpose. Listing every remaining path is
    // unbounded display for an unbounded repo; the aggregate totals always
    // include these files, so nothing is silently dropped from the counts.
    const restCount = entries.length - rowsCap;
    const restSkipped = entries.slice(rowsCap).reduce((sum, [, facts]) => sum + facts.longLines + facts.skippedCodeLines, 0);
    const restSuppressed = entries.slice(rowsCap).reduce((sum, [, facts]) => sum + facts.capSuppressed, 0);
    const restParts: string[] = [];
    if (restSkipped > 0) restParts.push(`${restSkipped} skipped lines`);
    if (restSuppressed > 0) restParts.push(`${restSuppressed} withheld matches`);
    rows.push({
      scope: "line-level checks",
      reason: `${restCount} more files carry the same line-level caps (${restParts.join(" and ")}). Their paths are not listed here; the totals include them.`,
    });
  }
  return rows;
}

/**
 * The ordered plan, the lead prompt, and the two follow-up prompts, derived from
 * a finding set. Extracted so the local review can rebuild them after a change
 * run scopes the findings to the diff; otherwise the report would still
 * recommend fixes for findings it no longer lists.
 */
function derivePlanAndPrompts(findings: ReviewFinding[]): {
  plan: ReviewReport["plan"];
  lead: string;
  prompts: string[];
} {
  const rankable: RankableFinding[] = findings.map((item) => ({
    fingerprint: item.fingerprint,
    severity: item.severity,
    ruleId: item.ruleId,
    title: item.title,
  }));
  const order = tableOrder(rankable);
  const promptsIn: PromptFinding[] = findings.map((item) => ({
    ruleId: item.ruleId,
    fingerprint: item.fingerprint,
    path: item.path,
    line: item.line,
    severity: item.severity,
    title: item.title,
    why: item.why,
  }));
  const plan = buildFixPlan(findings);
  const top = buildTopPrompt(promptsIn, plan.steps, [], 3, order);
  const lead = top.lead?.prompt ?? "Nothing was flagged in the files we read. This is not a clean bill of health.";
  const prompts = top.prompts
    .filter((item) => item.ruleId !== top.lead?.ruleId)
    .slice(0, 2)
    .map((item) => item.prompt);
  return {
    plan: plan.steps.map((step) => ({
      order: step.order,
      title: step.title,
      why: step.why,
      files: step.files,
      checklist: step.checklist,
    })),
    lead,
    prompts,
  };
}

/**
 * Rebuild the plan, lead, and prompts from the report's current findings. The
 * local review calls this after scoping a change run, so the recommended fixes
 * match the findings the report actually lists.
 */
export function refreshDerivations(report: ReviewReport): void {
  const derived = derivePlanAndPrompts(report.findings);
  report.plan = derived.plan;
  report.lead = derived.lead;
  report.prompts = derived.prompts;
}

export function buildLocalReport(
  files: ReviewFile[],
  skipped: NotChecked[],
  registry: RegistryFact[] | null,
  advisories: AdvisoryCoverage | null = null,
  lockFileInHand: ReviewFile | undefined = undefined,
  allowedLicences: readonly string[] = [],
  trackedEnvPaths: ReadonlySet<string> | null = null,
): ReviewReport {
  const paths = files.map((file) => file.path);
  // The scan result is the findings array with omission facts attached. The
  // report carries both: the findings as before, and the omissions as counts
  // in the not-checked list plus the aggregate field.
  // trackedEnvPaths carries the paths Git really tracks. Null means tracked
  // status is unknown, so `secret.tracked-env` cannot judge and must not fire.
  const secretScan = scanSecrets(files, trackedEnvPaths);
  const secretOmissions = secretScan.omissions ?? null;
  const findings: ReviewFinding[] = [];
  for (const match of secretScan) {
    const text = TEXT[match.ruleId] ?? {
      title: match.ruleId,
      why: "A fixed check matched this line.",
    };
    findings.push(finding(match.ruleId, match.path, match.line, text.title, text.why, match.snippet));
  }

  const deps = parseManifests(files);
  for (const script of deps.installScripts) {
    findings.push(
      finding(
        "deps.install-script",
        script.manifest,
        1,
        `Lifecycle script ${script.script} is declared`,
        `The ${script.script} script is named in the manifest. This review did not run it.`,
        script.script,
      ),
    );
  }

  const licenses = analyzeLicenses(paths, files, files.length > 0);
  // A licence policy the lane calls Allowed is not a finding. The hosted path
  // emits nothing in that case, and the local path must agree, or a clean MIT
  // repo carries a medium "needs attention" row on one door and not the other.
  // Severity follows the same ladder as the hosted door: Not recommended is
  // high, Not checked is info, everything else is medium.
  if (licenses.policy !== "Allowed") {
    const licenseSeverity: Severity =
      licenses.policy === "Not recommended" ? "high" : licenses.policy === "Not checked" ? "info" : "medium";
    findings.push(
      finding(
        "license.policy",
        licenses.files[0] ?? "(repo)",
        1,
        licenses.detected.length > 0 ? `License signals: ${licenses.detected.join(", ")}` : "No license signal in the files read",
        licenses.note,
        licenses.note,
        licenseSeverity,
      ),
    );
  }

  const lockFile = files.find((file) => (file.path.split("/").pop() ?? "") === "package-lock.json");
  const direct = new Set(deps.deps.filter((dep) => dep.ecosystem === "npm").map((dep) => dep.name));
  // Only the npm lockfile is inventoried here. A Cargo.lock or a yarn.lock was
  // still a lockfile in the read, so it must not be reported as "no lockfile
  // was in hand". It is named, and named as not read for versions.
  const otherLocks = files
    .map((file) => file.path)
    .filter((path) => OTHER_LOCKFILES.has((path.split("/").pop() ?? "").toLowerCase()));
  const inventory = lockFile === undefined
    ? {
        packages: [],
        complete: false,
        note: otherLocks.length === 0
          ? "No npm lockfile was in the files read. The dependency inventory is incomplete."
          : `No npm lockfile was in the files read. ${listNames(otherLocks)} was in the files read and was not read for versions. The dependency inventory is incomplete.`,
      }
    : inventoryNpmLock(lockFile.content, direct);

  const notChecked = [...skipped];
  if (!inventory.complete) notChecked.push({ scope: "npm lockfile", reason: inventory.note });
  // A skipped line is a check that did not run on that line. Naming the file
  // and the count keeps the cap from reading as "nothing was there"; the caps
  // themselves are unchanged, and no line text is disclosed, only counts.
  const omissionRows = secretOmissions === null ? null : analyzerOmissionRows(secretOmissions, 10);
  if (omissionRows !== null) notChecked.push(...omissionRows);

  // The declaration lane reads the lockfile the repo committed, which is already
  // in hand. The node_modules fallback is deliberately not passed here: the
  // local walk skips node_modules, so this review has no installed manifest to
  // read and asking for one would name a gap it cannot fill.
  const declarationInventory =
    lockFile === undefined
      ? noLockfileInventory()
      : readNpmDependencyLicenses(lockFile.content, { directNames: direct });
  const artifact = buildNoticeArtifact(declarationInventory);
  // The guarded lookup has no lane on this path, so it is never called. The
  // refusal is recorded rather than omitted, because "we did not ask" and "we
  // asked and got nothing" are different facts.
  const lookup = licenseLookupRefusal(declarationInventory.components);
  const licenseDeclaration: LicenseDeclaration = {
    components: declarationInventory.components.length,
    unknown: declarationInventory.unknown,
    complete: declarationInventory.complete,
    note: declarationInventory.note,
    notice: artifact.markdown,
    noticeFilename: artifact.filename,
    notCovered: artifact.notCovered,
    suggestions: lookup.suggestions,
  };
  const mixCounts = new Map<string, number>();
  for (const component of declarationInventory.components) {
    mixCounts.set(component.spdx, (mixCounts.get(component.spdx) ?? 0) + 1);
  }
  const licenseSuggestion = suggestProjectLicence({
    project: licenses.detected[0] ?? null,
    mix: [...mixCounts.entries()].map(([id, count]) => ({ id, count })),
    allowed: allowedLicences,
  });
  for (const item of declarationInventory.notCovered) {
    notChecked.push({ scope: "dependency licences", reason: `${item.charAt(0).toUpperCase()}${item.slice(1)}.` });
  }
  if (declarationInventory.complete && declarationInventory.counted > 0) {
    notChecked.push({
      scope: "dependency licence terms",
      reason: lookup.configured
        ? "A guarded AI lookup was available for the Unknown licences."
        : lookup.note,
    });
  }
  if (registry === null) {
    notChecked.push({ scope: "dependency terms", reason: "deps.dev and ClearlyDefined were not queried. Unknown stays unknown." });
  } else {
    const project = licenses.packageLicense ?? licenses.detected.join(" ");
    for (const fact of registry) {
      if (fact.deprecated === true) {
        const reason = fact.deprecatedReason ?? "The registry marked this version deprecated.";
        findings.push(finding(
          "deps.deprecated",
          `${fact.name}@${fact.version}`,
          1,
          `${fact.name}@${fact.version} is marked deprecated`,
          `${reason} Yanked was not a separate flag in this record.`,
          fact.name,
        ));
      }
      if (fact.publishedAt) {
        const when = fact.isDefault
          ? `Default version ${fact.version} was published ${fact.publishedAt}.`
          : `Version ${fact.version} was published ${fact.publishedAt}. The last release date of other versions was not read.`;
        notChecked.push({ scope: `${fact.name} release`, reason: when });
      }
      if (fact.license === null) {
        notChecked.push({ scope: `${fact.name}@${fact.version}`, reason: fact.note });
        continue;
      }
      const clash = clashSignal(project, fact.license);
      if (clash !== null) {
        findings.push(finding("license.clash", fact.name, 1, `Review ${fact.name}@${fact.version}`, clash, fact.license));
      }
    }
    notChecked.push({
      scope: "archived",
      reason: "Archived status is not in the deps.dev record. Unknown stays unknown.",
    });
  }
  if (advisories === null) {
    // A lockfile we read but did not query is a different gap from having no
    // lockfile at all. Naming the file keeps the two apart, so "we had versions
    // and checked none of them" can never read as "there was nothing to check".
    notChecked.push({
      scope: "OSV",
      reason: lockFileInHand !== undefined
        ? `${lockFileInHand.path} was in the files read and its versions were not queried. Unknown stays unknown.`
        : otherLocks.length > 0
          ? `No npm lockfile was in the files read, so no npm version could be queried. ${listNames(otherLocks)} was in the files read and was not queried either. Unknown stays unknown.`
          : "No lockfile was in the files read, so no version could be queried. Unknown stays unknown.",
    });
  } else if (advisories.timedOut) {
    notChecked.push({
      scope: "OSV",
      reason: `The advisory query did not finish. ${advisories.queried} coordinates were sent. This is not a pass.`,
    });
  } else {
    if (advisories.skipped > 0) {
      notChecked.push({
        scope: "OSV",
        reason: `Queried ${advisories.queried} lockfile packages. ${advisories.skipped} were not queried.`,
      });
    }
    // A coordinate the answer did not cover is not a clean coordinate. A short
    // result list, a malformed entry, or an unreadable vulns field all land in
    // this count, and none of them may read as "no advisories found".
    if (advisories.unanswered > 0) {
      notChecked.push({
        scope: "OSV",
        reason: `${advisories.unanswered} of ${advisories.queried} queried coordinates had no readable answer. Those versions were not checked. Unknown stays unknown.`,
      });
    }
    // Records the answer listed that could not be read, or that sat past the
    // per-coordinate listing cap. Counted, so an unreadable or unlisted advisory
    // can never hide behind a clean line.
    if (advisories.unreadable > 0) {
      notChecked.push({
        scope: "OSV",
        reason: `${advisories.unreadable} advisory record${advisories.unreadable === 1 ? "" : "s"} the answer named could not be read or could not be listed. Those are not cleared. Unknown stays unknown.`,
      });
    }
    const listed = advisories.hits.slice(0, 20);
    for (const hit of listed) {
      // An unknown advisory severity is real but unranked, so it lands at info,
      // the same choice the hosted door makes. A guessed medium here would let a
      // low-confidence advisory outrank a known medium finding.
      const severity: Severity = hit.severity === "high" || hit.severity === "low" || hit.severity === "medium"
        ? hit.severity
        : "info";
      const title = `${hit.id} is recorded for ${hit.name}@${hit.version}`;
      const why = `${hit.id} is a public advisory record for this exact ${hit.depth} version. This is not a statement that the app is exploitable.`;
      findings.push({
        ruleId: "deps.vulnerability",
        path: `${hit.name}@${hit.version}`,
        line: 1,
        severity,
        title,
        why,
        fingerprint: fingerprintFinding("deps.vulnerability", ANALYZER_VERSION, `${hit.name}@${hit.version}`, redactedSnippet(title)),
      });
    }
    if (advisories.hits.length > listed.length) {
      notChecked.push({
        scope: "OSV",
        reason: `${advisories.hits.length - listed.length} more advisory rows were not listed.`,
      });
    }
  }

  const hostHits = networkHints(files);
  for (const hit of [
    ...repeatedFunctions(files),
    ...deadCopies(files),
    ...hostHits,
    ...modelCards(files),
    ...generatedMarkers(files),
  ]) {
    findings.push(finding(hit.ruleId, hit.path, hit.line, hit.title, hit.why, hit.title));
  }
  // A cap that is not named reads as a complete list. The check stops at the
  // cap, so the report says how many naming files were left out.
  if (hostHits.length >= NETWORK_HINT_CAP) {
    const leftOut = countNamedHosts(files) - hostHits.length;
    if (leftOut > 0) {
      notChecked.push({
        scope: "named hosts",
        reason: `The named-host list stops at ${NETWORK_HINT_CAP} files per run. ${leftOut} more file${leftOut === 1 ? "" : "s"} that name a host were not listed.`,
      });
    }
  }

  const hygiene = analyzeHygiene(
    paths,
    files.map((file) => ({ path: file.path, content: file.content, size: file.content.length })),
    skipped.map((item) => item.scope),
  );
  if (!hygiene.hasReadme) {
    findings.push(finding("hygiene.no-readme", "(repo)", 1, "No README in the files read", "A README was not in this read.", "no readme"));
  }

  const derived = derivePlanAndPrompts(findings);
  const plan = derived.plan;
  const lead = derived.lead;
  const promptLines = derived.prompts;

  const filesSkipped = skipped.length;
  const coverageNote = `We read ${files.length} files. ${filesSkipped} skips are listed. A partial result is not a pass.`;
  // The local review overrides this in change mode. Whole-tree stays the
  // default here, so a caller that does not set a scope still names one.
  const scopeNote = `Reviewed: whole working tree, ${files.length} files.`;
  // Completeness is NOT decided here. A governance refusal and the walk's
  // explicit flags are not known in this builder, and inferring status from the
  // shared skipped list is exactly the shortcut this feature removes. The local
  // review computes the real status after governance and overwrites both
  // fields. The provisional value is partial, so an unrefined report never
  // reads as a pass.
  const status: ReviewReport["status"] = "partial";
  const statusNote = "Review incomplete. Every reason is in the not-checked list.";

  const sbom = inventory.packages.length === 0
    ? null
    : {
        tool: "launchsense-lockfile",
        components: inventory.packages.length,
        omissions: [
          "npm lockfile only",
          "no binary scan",
          registry === null ? "dependency terms not queried" : "terms only where a registry answered",
        ],
      };

  // The aggregate the JSON carries. The scan computes it once; the report
  // passes it through unchanged so no scan ever runs twice for the same facts.
  const analyzerOmissions = secretOmissions === null
    ? null
    : {
        files: secretOmissions.files,
        longLines: secretOmissions.longLines,
        codeSkippedLines: secretOmissions.codeSkippedLines,
        suppressedMatches: secretOmissions.suppressedMatches,
      };

  return {
    stage: "alpha",
    authRequired: false,
    status,
    statusNote,
    filesRead: files.length,
    filesSkipped,
    coverageNote,
    scopeNote,
    notChecked,
    findings,
    lead,
    prompts: promptLines,
    plan,
    orderSource: "table",
    orderNote: "Ordered by severity and credential risk alone. The model did not choose which findings exist.",
    orderMoved: 0,
    laneAnswered: false,
    lockNote: inventory.note,
    sbom,
    licenseDeclaration,
    licenseSuggestion,
    analyzerOmissions,
  };
}
