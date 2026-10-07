// Honest standards lines. Signals with evidence only. Never a certification claim.
// A row is partial only where a check in this repo already exists. Everything else
// stays not-checked.

export type Coverage = "full" | "partial" | "not-automatable";

export interface StandardMapping {
  version: string;
  requirementId: string;
  title: string;
  coverage: Coverage;
  status: "signal-found" | "no-signal" | "not-checked";
  evidenceRuleIds: string[];
  evidenceCount: number;
  caveat: string;
  source: string;
}

export interface MappingInput {
  findings: Array<{ ruleId: string; severity: string }>;
  analyzedFiles: number;
  liveChecked: boolean;
  /** Coverage sentence from the scan. OSV rows read the package window from it. */
  coverageNote?: string | null;
}

export interface OsvWindow {
  checked: number;
  unknown: number;
}

const ASVS = "OWASP ASVS 5.0.0";
const ASVS_SOURCE = "https://owasp.org/www-project-application-security-verification-standard/";
const TOP10 = "OWASP Top 10:2025";
const TOP10_SOURCE = "https://owasp.org/Top10/2025/";
const TOP25 = "CWE Top 25 (2024)";
const TOP25_SOURCE = "https://cwe.mitre.org/top25/";
const SSDF = "NIST SSDF 1.1";
const SSDF_SOURCE = "https://csrc.nist.gov/projects/ssdf";
const SLSA = "SLSA 1.0";
const SLSA_SOURCE = "https://slsa.dev/";

const CREDENTIAL_RULES = [
  "secret.tracked-env",
  "secret.client-exposure",
  "secret.credential-pattern",
  "secret.private-key",
  "secret.aws-key",
  "secret.github-token",
];

const SUPPLY_RULES = ["deps.vulnerability", "deps.install-script", "deps.unpinned-version"];

type StatusKind = "evidence" | "live" | "always-not-checked" | "osv" | "supply-chain";

interface Rule {
  id: string;
  title: string;
  version: string;
  source: string;
  coverage: Coverage;
  rules: string[];
  caveat: string;
  kind: StatusKind;
}

const RULES: Rule[] = [
  {
    id: "V2.1.1",
    title: "Secure Software Design",
    version: ASVS,
    source: ASVS_SOURCE,
    coverage: "not-automatable",
    rules: [],
    caveat: "Design review is a human job. We only show signals.",
    kind: "always-not-checked",
  },
  {
    id: "V2.2.1",
    title: "Secure Authentication Architecture",
    version: ASVS,
    source: ASVS_SOURCE,
    coverage: "not-automatable",
    rules: [],
    caveat: "We do not test authentication behaviour.",
    kind: "always-not-checked",
  },
  {
    id: "V4.1.1",
    title: "Secure User Interface",
    version: ASVS,
    source: ASVS_SOURCE,
    coverage: "not-automatable",
    rules: [],
    caveat: "No browser rendering check in this release.",
    kind: "always-not-checked",
  },
  {
    id: "V8.1.1",
    title: "Data Protection",
    version: ASVS,
    source: ASVS_SOURCE,
    coverage: "partial",
    rules: ["secret.tracked-env", "secret.client-exposure", "secret.credential-pattern"],
    caveat: "We scan fetched text files for credential patterns only.",
    kind: "evidence",
  },
  {
    id: "V9.1.1",
    title: "Secure Communications",
    version: ASVS,
    source: ASVS_SOURCE,
    coverage: "not-automatable",
    rules: [],
    caveat: "Communications are a runtime property. The live-site check was removed from the product, so nothing here is read.",
    kind: "always-not-checked",
  },
  {
    id: "V12.1.1",
    title: "File and Error Handling",
    version: ASVS,
    source: ASVS_SOURCE,
    coverage: "partial",
    rules: ["secret.debug-leftover"],
    caveat: "Debug leftovers only. No runtime error testing.",
    kind: "evidence",
  },
  {
    id: "V14.1.1",
    title: "Configuration",
    version: ASVS,
    source: ASVS_SOURCE,
    coverage: "partial",
    rules: ["deps.unpinned-version", "deps.install-script", "deps.duplicate"],
    caveat: "Manifest signals only, not runtime configuration.",
    kind: "evidence",
  },
  {
    id: "V15.1.1",
    title: "Secure Validation",
    version: ASVS,
    source: ASVS_SOURCE,
    coverage: "partial",
    rules: ["secret.eval-use", "secret.sql-pattern", "code.eval-use", "code.sql-pattern"],
    caveat: "Static patterns only. No fuzzing or injection testing.",
    kind: "evidence",
  },
  {
    id: "A01:2025",
    title: "Broken Access Control",
    version: TOP10,
    source: TOP10_SOURCE,
    coverage: "not-automatable",
    rules: [],
    caveat: "We do not test access control.",
    kind: "always-not-checked",
  },
  {
    id: "A02:2025",
    title: "Security Misconfiguration",
    version: TOP10,
    source: TOP10_SOURCE,
    coverage: "partial",
    rules: ["secret.debug-leftover", "secret.debugger-statement", "code.debug-leftover", "code.debugger-statement"],
    caveat: "Debug leftovers and debugger statements only.",
    kind: "evidence",
  },
  {
    id: "A03:2025",
    title: "Software Supply Chain Failures",
    version: TOP10,
    source: TOP10_SOURCE,
    coverage: "partial",
    rules: SUPPLY_RULES,
    caveat:
      "Install scripts, floating versions, and OSV advisories only. If the OSV window is unknown, a quiet row is not a pass.",
    kind: "supply-chain",
  },
  {
    id: "A04:2025",
    title: "Cryptographic Failures",
    version: TOP10,
    source: TOP10_SOURCE,
    coverage: "partial",
    rules: ["code.weak-crypto"],
    caveat: "Weak hash and cipher calls only. A hard-coded credential is a CWE-798 row, not a cryptographic failure.",
    kind: "evidence",
  },
  {
    id: "A05:2025",
    title: "Injection",
    version: TOP10,
    source: TOP10_SOURCE,
    coverage: "partial",
    rules: ["secret.eval-use", "secret.sql-pattern", "code.eval-use", "code.sql-pattern"],
    caveat: "Static patterns only. No injection testing.",
    kind: "evidence",
  },
  {
    id: "A06:2025",
    title: "Insecure Design",
    version: TOP10,
    source: TOP10_SOURCE,
    coverage: "not-automatable",
    rules: [],
    caveat: "Design review is not something this scan can do.",
    kind: "always-not-checked",
  },
  {
    id: "A07:2025",
    title: "Authentication Failures",
    version: TOP10,
    source: TOP10_SOURCE,
    coverage: "not-automatable",
    rules: [],
    caveat: "We do not test sign-in behaviour.",
    kind: "always-not-checked",
  },
  {
    id: "A08:2025",
    title: "Software or Data Integrity Failures",
    version: TOP10,
    source: TOP10_SOURCE,
    coverage: "partial",
    rules: ["deps.install-script"],
    caveat: "Install scripts only. Not signatures or provenance.",
    kind: "evidence",
  },
  {
    id: "A09:2025",
    title: "Security Logging and Alerting Failures",
    version: TOP10,
    source: TOP10_SOURCE,
    coverage: "not-automatable",
    rules: [],
    caveat: "We do not read logs or alerts.",
    kind: "always-not-checked",
  },
  {
    id: "A10:2025",
    title: "Mishandling of Exceptional Conditions",
    version: TOP10,
    source: TOP10_SOURCE,
    coverage: "not-automatable",
    rules: [],
    caveat: "We do not test how the app handles errors.",
    kind: "always-not-checked",
  },
  {
    id: "query",
    title: "Known vulnerabilities for exact versions",
    version: "OSV",
    source: "https://osv.dev/",
    coverage: "partial",
    rules: ["deps.vulnerability"],
    caveat: "npm, PyPI, and Go only, at most 50 packages. A timeout is not a pass. Other ecosystems are not checked.",
    kind: "osv",
  },
  {
    id: "CWE-798",
    title: "Hard-coded credentials",
    version: "CWE",
    source: "https://cwe.mitre.org/data/definitions/798.html",
    coverage: "partial",
    rules: CREDENTIAL_RULES,
    caveat: "Label on credential patterns we already scan. Not a new check.",
    kind: "evidence",
  },
  {
    id: "CWE-89",
    title: "SQL-shaped strings",
    version: "CWE",
    source: "https://cwe.mitre.org/data/definitions/89.html",
    coverage: "partial",
    rules: ["secret.sql-pattern", "code.sql-pattern"],
    caveat: "Label on the SQL-shaped pattern we already scan. Not a new check.",
    kind: "evidence",
  },
  {
    id: "CWE-95",
    title: "Dynamically evaluated code",
    version: "CWE",
    source: "https://cwe.mitre.org/data/definitions/95.html",
    coverage: "partial",
    rules: ["secret.eval-use", "code.eval-use"],
    caveat: "Label on the eval pattern we already scan. Not a new check.",
    kind: "evidence",
  },
  {
    id: "CWE-79",
    title: "Cross-site scripting sink",
    version: "CWE",
    source: "https://cwe.mitre.org/data/definitions/79.html",
    coverage: "partial",
    rules: ["code.inner-html"],
    caveat:
      "Label on innerHTML assignments we already scan. Identifies a potential XSS sink, not proof of XSS.",
    kind: "evidence",
  },
  {
    id: "CWE-78",
    title: "Command execution surface",
    version: "CWE",
    source: "https://cwe.mitre.org/data/definitions/78.html",
    coverage: "partial",
    rules: ["code.child-process"],
    caveat:
      "Label on child_process use we already scan. Identifies a potential command-injection vector, not proof of injection.",
    kind: "evidence",
  },
  {
    id: "CWE-327",
    title: "Broken or risky cryptographic algorithm",
    version: "CWE",
    source: "https://cwe.mitre.org/data/definitions/327.html",
    coverage: "partial",
    rules: ["code.weak-crypto"],
    caveat:
      "Label on weak hash and cipher calls we already scan. MD5 for a checksum is not the same as MD5 for a password hash.",
    kind: "evidence",
  },
  {
    id: "CWE-942",
    title: "Permissive cross-domain policy",
    version: "CWE",
    source: "https://cwe.mitre.org/data/definitions/942.html",
    coverage: "partial",
    rules: ["code.cors-wildcard"],
    caveat:
      "Label on wildcard CORS we already scan. A star origin is not always a vulnerability, but it is a permissive policy.",
    kind: "evidence",
  },
  {
    id: "Top25-CWE-79",
    title: "Cross-site scripting sink (Top 25)",
    version: TOP25,
    source: TOP25_SOURCE,
    coverage: "partial",
    rules: ["code.inner-html"],
    caveat:
      "Top 25 label on innerHTML assignments we already scan. Identifies a potential XSS sink, not proof of XSS.",
    kind: "evidence",
  },
  {
    id: "Top25-CWE-89",
    title: "SQL-shaped strings (Top 25)",
    version: TOP25,
    source: TOP25_SOURCE,
    coverage: "partial",
    rules: ["secret.sql-pattern", "code.sql-pattern"],
    caveat: "Top 25 label on the SQL-shaped pattern we already scan. Not a new check.",
    kind: "evidence",
  },
  {
    id: "Top25-CWE-78",
    title: "Command execution surface (Top 25)",
    version: TOP25,
    source: TOP25_SOURCE,
    coverage: "partial",
    rules: ["code.child-process"],
    caveat:
      "Top 25 label on child_process use we already scan. Identifies a potential command-injection vector, not proof of injection.",
    kind: "evidence",
  },
  {
    id: "Top25-CWE-798",
    title: "Hard-coded credentials (Top 25)",
    version: TOP25,
    source: TOP25_SOURCE,
    coverage: "partial",
    rules: CREDENTIAL_RULES,
    caveat: "Top 25 label on credential patterns we already scan. Not a new check.",
    kind: "evidence",
  },
  {
    id: "PW.7.2",
    title: "Review and analyze human-readable code",
    version: SSDF,
    source: SSDF_SOURCE,
    coverage: "partial",
    rules: [
      "secret.tracked-env",
      "secret.client-exposure",
      "secret.credential-pattern",
      "secret.private-key",
      "secret.aws-key",
      "secret.github-token",
      "secret.eval-use",
      "secret.sql-pattern",
      "code.eval-use",
      "code.sql-pattern",
      "code.inner-html",
      "code.child-process",
      "code.weak-crypto",
      "code.cors-wildcard",
    ],
    caveat: "Automated static patterns only. No manual review, no design review.",
    kind: "evidence",
  },
  {
    id: "PW.4.4",
    title: "Verify third-party components against known vulnerabilities",
    version: SSDF,
    source: SSDF_SOURCE,
    coverage: "partial",
    rules: ["deps.vulnerability"],
    caveat:
      "OSV advisories for exact versions only, at most 50 packages. If the OSV window is unknown, a quiet row is not a pass.",
    kind: "supply-chain",
  },
  {
    id: "PW.4.1",
    title: "Acquire vetted components and track their versions",
    version: SSDF,
    source: SSDF_SOURCE,
    coverage: "partial",
    rules: ["deps.unpinned-version", "deps.install-script"],
    caveat: "Manifest signals only. No vetting of a component security posture.",
    kind: "evidence",
  },
  {
    id: "PS.3.2",
    title: "Collect and share provenance for each release",
    version: SSDF,
    source: SSDF_SOURCE,
    coverage: "not-automatable",
    rules: [],
    caveat: "We write a local CycloneDX SBOM but verify no provenance and sign nothing.",
    kind: "always-not-checked",
  },
  {
    id: "SLSA Build L1",
    title: "Build provenance exists",
    version: SLSA,
    source: SLSA_SOURCE,
    coverage: "not-automatable",
    rules: [],
    caveat: "We check no build provenance. A lockfile inventory is not a build attestation.",
    kind: "always-not-checked",
  },
  {
    id: "SLSA Build L2",
    title: "Signed build provenance",
    version: SLSA,
    source: SLSA_SOURCE,
    coverage: "not-automatable",
    rules: [],
    caveat: "We check no signatures. Nothing here is signed.",
    kind: "always-not-checked",
  },
  {
    id: "SLSA Build L3",
    title: "Hardened build platform",
    version: SLSA,
    source: SLSA_SOURCE,
    coverage: "not-automatable",
    rules: [],
    caveat: "We observe no build platform. This scan reads files after the fact.",
    kind: "always-not-checked",
  },
  {
    id: "deps.dev",
    title: "Dependency metadata",
    version: "deps.dev",
    source: "https://deps.dev/",
    coverage: "not-automatable",
    rules: [],
    caveat: "Not queried in this release.",
    kind: "always-not-checked",
  },
  {
    id: "Scorecard",
    title: "OpenSSF Scorecard",
    version: "OpenSSF Scorecard",
    source: "https://scorecard.dev/",
    coverage: "not-automatable",
    rules: [],
    caveat: "We do not call scorecard.dev. A workflow file, a test file, or a license file is not a Scorecard result.",
    kind: "always-not-checked",
  },
];

/** Reads the OSV window from the coverage sentence. Missing or unreadable means unknown. */
export function readOsvWindow(coverageNote: string | null | undefined): OsvWindow | null {
  if (coverageNote === null || coverageNote === undefined || coverageNote.length === 0) return null;
  const match = /OSV checked (\d+) packages, (\d+) unknown/.exec(coverageNote);
  if (match === null) return null;
  return { checked: Number(match[1]), unknown: Number(match[2]) };
}

function countRules(rules: string[], byRule: Map<string, number>): number {
  return rules.reduce((sum, ruleId) => sum + (byRule.get(ruleId) ?? 0), 0);
}

function osvClean(window: OsvWindow | null): boolean {
  return window !== null && window.checked > 0 && window.unknown === 0;
}

function statusFor(
  rule: Rule,
  evidenceCount: number,
  input: MappingInput,
  window: OsvWindow | null,
): StandardMapping["status"] {
  switch (rule.kind) {
    case "always-not-checked":
      return "not-checked";
    case "evidence":
      if (rule.rules.length === 0) return "not-checked";
      return evidenceCount > 0 ? "signal-found" : "no-signal";
    case "live":
      // No row uses this kind since the live-site check was removed from the
      // product. It stays so a future live signal has a home, and it is
      // unreachable today on purpose.
      return input.liveChecked ? "no-signal" : "not-checked";
    case "osv":
      if (evidenceCount > 0) return "signal-found";
      return osvClean(window) ? "no-signal" : "not-checked";
    case "supply-chain":
      if (evidenceCount > 0) return "signal-found";
      if (window !== null && window.unknown > 0) return "not-checked";
      return osvClean(window) ? "no-signal" : "not-checked";
    default: {
      const neverKind: never = rule.kind;
      return neverKind;
    }
  }
}

export function buildStandards(input: MappingInput): StandardMapping[] {
  const byRule = new Map<string, number>();
  for (const finding of input.findings) {
    byRule.set(finding.ruleId, (byRule.get(finding.ruleId) ?? 0) + 1);
  }
  const window = readOsvWindow(input.coverageNote);
  return RULES.map((rule) => {
    const evidenceCount = countRules(rule.rules, byRule);
    return {
      version: rule.version,
      requirementId: rule.id,
      title: rule.title,
      coverage: rule.coverage,
      status: statusFor(rule, evidenceCount, input, window),
      evidenceRuleIds: rule.rules,
      evidenceCount,
      caveat: rule.caveat,
      source: rule.source,
    };
  });
}

/**
 * The coverage metric. Two axes, never merged.
 *
 * `coverage` is what the product can check at all (partial, not-automatable,
 * full). `status` is what this scan actually found. A row can be coverage
 * `partial` and status `not-checked` at once (the OSV window was unknown), so
 * adding them into one number would double count and mislead. This returns both.
 *
 * Invariant held by tests/license-scope-checks.mjs and the standards checks: a
 * `partial` row always names a live evidence rule, so the partial count is a
 * count of real checks, not labels.
 */
export interface StandardsCoverage {
  coverage: { full: number; partial: number; notAutomatable: number };
  status: { signalFound: number; noSignal: number; notChecked: number };
  total: number;
}

export function standardsCoverage(rows: readonly StandardMapping[]): StandardsCoverage {
  const coverage = { full: 0, partial: 0, notAutomatable: 0 };
  const status = { signalFound: 0, noSignal: 0, notChecked: 0 };
  for (const row of rows) {
    if (row.coverage === "full") coverage.full += 1;
    else if (row.coverage === "partial") coverage.partial += 1;
    else coverage.notAutomatable += 1;
    if (row.status === "signal-found") status.signalFound += 1;
    else if (row.status === "no-signal") status.noSignal += 1;
    else status.notChecked += 1;
  }
  return { coverage, status, total: rows.length };
}
