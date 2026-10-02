// One honest line per OWASP ASVS 5.0.0 requirement we can partially map.
// Signals with evidence only. Never a certification claim.

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
}

const RULES: Array<{
  id: string;
  title: string;
  coverage: Coverage;
  rules: string[];
  caveat: string;
}> = [
  {
    id: "V2.1.1",
    title: "Secure Software Design",
    coverage: "not-automatable",
    rules: [],
    caveat: "Design review is a human job. We only show signals.",
  },
  {
    id: "V2.2.1",
    title: "Secure Authentication Architecture",
    coverage: "not-automatable",
    rules: [],
    caveat: "We do not test authentication behaviour.",
  },
  {
    id: "V4.1.1",
    title: "Secure User Interface",
    coverage: "not-automatable",
    rules: [],
    caveat: "No browser rendering check in this release.",
  },
  {
    id: "V8.1.1",
    title: "Data Protection",
    coverage: "partial",
    rules: ["secret.tracked-env", "secret.client-exposure", "secret.credential-pattern"],
    caveat: "We scan fetched text files for credential patterns only.",
  },
  {
    id: "V9.1.1",
    title: "Secure Communications",
    coverage: "partial",
    rules: [],
    caveat: "HTTPS on the live site only, when a live URL is given.",
  },
  {
    id: "V12.1.1",
    title: "File and Error Handling",
    coverage: "partial",
    rules: ["secret.debug-leftover"],
    caveat: "Debug leftovers only. No runtime error testing.",
  },
  {
    id: "V14.1.1",
    title: "Configuration",
    coverage: "partial",
    rules: ["deps.unpinned-version", "deps.install-script", "deps.duplicate"],
    caveat: "Manifest signals only, not runtime configuration.",
  },
  {
    id: "V15.1.1",
    title: "Secure Validation",
    coverage: "partial",
    rules: ["secret.eval-use", "secret.sql-pattern"],
    caveat: "Static patterns only. No fuzzing or injection testing.",
  },
];

export function buildStandards(input: MappingInput): StandardMapping[] {
  const byRule = new Map<string, number>();
  for (const f of input.findings) {
    byRule.set(f.ruleId, (byRule.get(f.ruleId) ?? 0) + 1);
  }
  return RULES.map((rule) => {
    const evidenceCount = rule.rules.reduce((sum, r) => sum + (byRule.get(r) ?? 0), 0);
    let status: StandardMapping["status"] = "not-checked";
    if (rule.rules.length > 0) {
      status = evidenceCount > 0 ? "signal-found" : "no-signal";
    } else if (rule.coverage === "not-automatable") {
      status = "not-checked";
    } else if (rule.id === "V9.1.1") {
      status = input.liveChecked ? "no-signal" : "not-checked";
    }
    return {
      version: "OWASP ASVS 5.0.0",
      requirementId: rule.id,
      title: rule.title,
      coverage: rule.coverage,
      status,
      evidenceRuleIds: rule.rules,
      evidenceCount,
      caveat: rule.caveat,
      source: "https://owasp.org/www-project-application-security-verification-standard/",
    };
  });
}