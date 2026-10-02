// Minimal severity map for deterministic findings. High and medium findings
// need review before sharing; low and info are advisory only.

export type Severity = "high" | "medium" | "low" | "info";

// Debug noise is not a secret and never blocks a launch. A live debugger
// statement is different: it halts execution in front of whoever opens the
// app, so it stays at medium. Keeping these apart is what stops a normal
// console.log from making the judge-ready gate unreachable.
const HIGH_RULES = new Set([
  "secret.tracked-env",
  "secret.private-key",
  "secret.github-token",
  "secret.aws-key",
  "secret.credential-pattern",
  "secret.client-exposure",
  "secret.eval-use",
  "deps.vulnerability",
  "deps.install-script",
]);

const MEDIUM_RULES = new Set([
  "secret.debugger-statement",
  "deps.unpinned-version",
  "license.policy",
]);

const LOW_RULES = new Set([
  "secret.debug-leftover",
  "secret.sql-pattern",
  "deps.duplicate",
]);

export function severityFor(ruleId: string): Severity {
  if (HIGH_RULES.has(ruleId)) return "high";
  if (MEDIUM_RULES.has(ruleId)) return "medium";
  if (LOW_RULES.has(ruleId)) return "low";
  return "info";
}

export function reviewRequired(severity: Severity): boolean {
  return severity === "high" || severity === "medium";
}
