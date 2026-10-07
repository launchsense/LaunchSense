// Builds the harness report from files already read into memory.
// No network. Registry facts are passed in when the caller looked them up.

import { analyzeHygiene } from "../analyzers/hygiene.ts";
import { analyzeLicenses } from "../analyzers/licenses.ts";
import { parseManifests } from "../analyzers/deps.ts";
import { scanSecrets } from "../analyzers/secrets.ts";
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
}

export interface ReviewReport {
  stage: "alpha";
  authRequired: false;
  status: "complete" | "partial";
  filesRead: number;
  filesSkipped: number;
  coverageNote: string;
  notChecked: NotChecked[];
  findings: ReviewFinding[];
  lead: string;
  prompts: string[];
  orderSource: "local" | "jev" | "perplexity" | "table";
  orderNote: string;
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
    title: "A child process exec call is present",
    why: "exec and execSync pass a string to a shell. This line was not run.",
  },
  "code.weak-crypto": {
    title: "A weak hash or cipher call is present",
    why: "md5, sha1, or createCipher showed up as a call. This is not a certificate verdict.",
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
const OTHER_LOCKFILES = new Set([
  "cargo.lock", "yarn.lock", "pnpm-lock.yaml", "poetry.lock", "gemfile.lock",
  "composer.lock", "packages.lock.json", "pipfile.lock", "mix.lock", "pubspec.lock",
  "gradle.lockfile", "go.sum",
]);

function listNames(paths: string[]): string {
  const named = paths.map((path) => path.split("/").pop() ?? path);
  if (named.length === 1) return named[0] ?? "";
  return `${named.slice(0, -1).join(", ")} and ${named[named.length - 1]}`;
}

export function buildLocalReport(
  files: ReviewFile[],
  skipped: NotChecked[],
  registry: RegistryFact[] | null,
  advisories: AdvisoryCoverage | null = null,
  lockFileInHand: ReviewFile | undefined = undefined,
  allowedLicences: readonly string[] = [],
): ReviewReport {
  const paths = files.map((file) => file.path);
  const secrets = scanSecrets(files);
  const findings: ReviewFinding[] = [];
  for (const match of secrets) {
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
  const top = buildTopPrompt(promptsIn, buildFixPlan(findings).steps, [], 3, order);
  const lead = top.lead?.prompt ?? "Nothing was flagged in the files we read. This is not a clean bill of health.";
  const promptLines = top.prompts
    .filter((item) => item.ruleId !== top.lead?.ruleId)
    .slice(0, 2)
    .map((item) => item.prompt);

  const filesSkipped = skipped.length;
  const osvOpen = advisories === null || advisories.timedOut || advisories.skipped > 0;
  const status = filesSkipped > 0 || !inventory.complete || registry === null || osvOpen ? "partial" : "complete";
  const coverageNote = `We read ${files.length} files. ${filesSkipped} skips are listed. A partial result is not a pass.`;

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

  return {
    stage: "alpha",
    authRequired: false,
    status,
    filesRead: files.length,
    filesSkipped,
    coverageNote,
    notChecked,
    findings,
    lead,
    prompts: promptLines,
    orderSource: "table",
    orderNote: "Ordered by severity and credential risk alone. The model did not choose which findings exist.",
    lockNote: inventory.note,
    sbom,
    licenseDeclaration,
    licenseSuggestion,
  };
}
