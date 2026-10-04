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
import { clashSignal } from "./clash.ts";
import { deadCopies, generatedMarkers, modelCards, networkHints, repeatedFunctions } from "./extraChecks.ts";
import { inventoryNpmLock } from "./lockfile.ts";

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
}

const TEXT: Record<string, { title: string; why: string }> = {
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
): ReviewFinding {
  const snippet = redactedSnippet(raw);
  return {
    ruleId,
    path,
    line,
    severity: severityForFinding(ruleId, path),
    title,
    why,
    fingerprint: fingerprintFinding(ruleId, ANALYZER_VERSION, path, snippet),
  };
}

export function buildLocalReport(
  files: ReviewFile[],
  skipped: NotChecked[],
  registry: RegistryFact[] | null,
  advisories: AdvisoryCoverage | null = null,
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
  findings.push(
    finding(
      "license.policy",
      licenses.files[0] ?? "(repo)",
      1,
      licenses.detected.length > 0 ? `License signals: ${licenses.detected.join(", ")}` : "No license signal in the files read",
      licenses.note,
      licenses.note,
    ),
  );

  const lockFile = files.find((file) => (file.path.split("/").pop() ?? "") === "package-lock.json");
  const direct = new Set(deps.deps.filter((dep) => dep.ecosystem === "npm").map((dep) => dep.name));
  const inventory = lockFile === undefined
    ? { packages: [], complete: false, note: "No npm lockfile was in the files read. The dependency inventory is incomplete." }
    : inventoryNpmLock(lockFile.content, direct);

  const notChecked = [...skipped];
  if (!inventory.complete) notChecked.push({ scope: "npm lockfile", reason: inventory.note });
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
    notChecked.push({ scope: "OSV", reason: "Lockfile versions were not queried. Unknown stays unknown." });
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
      const severity: Severity = hit.severity === "high" || hit.severity === "low" || hit.severity === "medium"
        ? hit.severity
        : "medium";
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

  for (const hit of [
    ...repeatedFunctions(files),
    ...deadCopies(files),
    ...networkHints(files),
    ...modelCards(files),
    ...generatedMarkers(files),
  ]) {
    findings.push(finding(hit.ruleId, hit.path, hit.line, hit.title, hit.why, hit.title));
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
  };
}
