// Minimal severity map for deterministic findings. High and medium findings
// need review before sharing; low and info are advisory only.

export type Severity = "high" | "medium" | "low" | "info";

// Debug noise is not a secret and never blocks a launch. A live debugger
// statement is different: it halts execution in front of whoever opens the
// app, so it stays at medium. Keeping these apart is what stops a normal
// console.log from making the share-ready gate unreachable.
const HIGH_RULES = new Set([
  "secret.tracked-env",
  "secret.private-key",
  "secret.github-token",
  "secret.aws-key",
  "secret.credential-pattern",
  "secret.client-exposure",
  "secret.eval-use",
  "code.eval-use",
  "code.child-process",
  "deps.vulnerability",
  "deps.install-script",
]);

const MEDIUM_RULES = new Set([
  "secret.debugger-statement",
  "code.debugger-statement",
  "code.inner-html",
  "code.weak-crypto",
  "deps.unpinned-version",
  "license.policy",
]);

const LOW_RULES = new Set([
  "secret.debug-leftover",
  "secret.sql-pattern",
  "code.debug-leftover",
  "code.sql-pattern",
  "code.cors-wildcard",
  "deps.duplicate",
]);

export function severityFor(ruleId: string): Severity {
  if (HIGH_RULES.has(ruleId)) return "high";
  if (MEDIUM_RULES.has(ruleId)) return "medium";
  if (LOW_RULES.has(ruleId)) return "low";
  return "info";
}

export function severityForFinding(ruleId: string, path: string): Severity {
  const base = severityFor(ruleId);
  const testLike =
    /(^|\/)(test|tests|__tests__|fixtures|testdata|examples)(\/|$)/i.test(path) ||
    /\.(test|spec)\.[a-z0-9]+$/i.test(path);
  if (testLike && base === "high") return "info";
  return base;
}

export function reviewRequired(severity: Severity): boolean {
  return severity === "high" || severity === "medium";
}
