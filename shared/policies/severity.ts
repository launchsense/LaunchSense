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

// Rules that are informational by design: hygiene gaps, a licence signal, a live
// check note, and the structural signals from the local review. Listing them
// explicitly means an emitted rule id is either classified here or the coverage
// test fails, instead of quietly becoming info through the fallthrough below.
const INFO_RULES = new Set([
  "hygiene.duplicates",
  "hygiene.env-usage",
  "hygiene.generated-file",
  "hygiene.languages",
  "hygiene.large-files",
  "hygiene.no-ci",
  "hygiene.no-readme",
  "hygiene.no-tests",
  "license.signal",
  "license.model-card",
  "code.dead-copy",
  "code.network-hint",
  "code.repeated-function",
  "live.blank",
  "live.down",
  "live.main-action",
  "live.no-https",
  "live.viewport",
]);

/** Every rule id this product can emit. The coverage test holds it complete. */
export const KNOWN_RULE_IDS: ReadonlySet<string> = new Set([
  ...HIGH_RULES,
  ...MEDIUM_RULES,
  ...LOW_RULES,
  ...INFO_RULES,
]);

export function severityFor(ruleId: string): Severity {
  if (HIGH_RULES.has(ruleId)) return "high";
  if (MEDIUM_RULES.has(ruleId)) return "medium";
  if (LOW_RULES.has(ruleId)) return "low";
  return "info";
}

// A test path is expected to hold fake keys, sample payloads, and probes, so a
// handful of rules are pure noise there. Only those rules are demoted. A real
// provider key committed under tests/ is still a committed key and stays high,
// and a weak-hash assertion line is still worth review at medium.
const TEST_PATH_NOISE = new Set([
  "code.weak-crypto",
  "code.debug-leftover",
  "secret.debug-leftover",
  "code.sql-pattern",
  "secret.sql-pattern",
]);

export function severityForFinding(ruleId: string, path: string): Severity {
  const base = severityFor(ruleId);
  const testLike =
    /(^|\/)(test|tests|__tests__|fixtures|testdata|examples)(\/|$)/i.test(path) ||
    /\.(test|spec)\.[a-z0-9]+$/i.test(path);
  if (testLike && TEST_PATH_NOISE.has(ruleId)) return "info";
  return base;
}

export function reviewRequired(severity: Severity): boolean {
  return severity === "high" || severity === "medium";
}
