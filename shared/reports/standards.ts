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
    coverage: "partial",
    rules: [],
    caveat: "HTTPS on the live site only, when a live URL is given.",
    kind: "live",
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
    rules: CREDENTIAL_RULES,
    caveat: "Pattern scan of fetched files, not a crypto review.",
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
    rules: ["secret.eval-use"],
    caveat: "Label on the eval pattern we already scan. Not a new check.",
    kind: "evidence",
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
