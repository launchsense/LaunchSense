// Minimal severity map for deterministic findings. High and medium findings
// need review before sharing; low and info are advisory only.

export type Severity = "high" | "medium" | "low" | "info";

export function severityFor(ruleId: string): Severity {
  if (
    ruleId === "secret.tracked-env" ||
    ruleId === "secret.private-key" ||
    ruleId === "secret.github-token" ||
    ruleId === "secret.aws-key" ||
    ruleId === "secret.credential-pattern" ||
    ruleId === "secret.client-exposure" ||
    ruleId === "secret.eval-use" ||
    ruleId === "deps.vulnerability" ||
    ruleId === "deps.install-script"
  ) {
    return "high";
  }
  if (
    ruleId === "secret.debug-leftover" ||
    ruleId === "deps.unpinned-version" ||
    ruleId === "license.policy"
  ) {
    return "medium";
  }
  if (ruleId === "secret.sql-pattern" || ruleId === "deps.duplicate") {
    return "low";
  }
  return "info";
}

export function reviewRequired(severity: Severity): boolean {
  return severity === "high" || severity === "medium";
}
