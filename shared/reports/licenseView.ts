// The licence-only view of a findings list. Pure: no React, no Convex.
//
// The hosted scan already returns every finding, so this page filters what is
// on screen rather than asking for a second scan. The filter is a whitelist,
// not a prefix match, so a new licence rule is a one-line decision here rather
// than an accident. license.signal never becomes a finding, so it is absent by
// construction and stays absent.

export const LICENSE_RULE_IDS = [
  "license.inventory",
  "license.declaration",
  "license.dependency",
  "license.policy",
] as const;

export type LicenseRuleId = (typeof LICENSE_RULE_IDS)[number];

export interface LicenseViewRow {
  ruleId: string;
  title: string;
  why: string;
  path: string;
  line: number;
  severity: string;
}

export interface LicenseView {
  declaration: LicenseViewRow | null;
  inventoryLines: string[];
  components: LicenseViewRow[];
  policy: LicenseViewRow | null;
  shownCount: number;
  withheldCount: number;
  coverage: "empty" | "no_licence_findings" | "licence_findings";
}

const SHOWN = new Set<string>([...LICENSE_RULE_IDS]);

function textOf(row: { title?: string; why?: string; snippet?: string }): string {
  if (typeof row.why === "string" && row.why.length > 0) return row.why;
  if (typeof row.snippet === "string" && row.snippet.length > 0) return row.snippet;
  return row.title ?? "";
}

/**
 * Split one findings list into the licence rows and the count this page did
 * not show. An empty scan and a scan with no licence rows render different
 * words, and neither renders a pass.
 */
export function licenseView(
  findings: ReadonlyArray<{
    ruleId: string;
    title?: string;
    why?: string;
    snippet?: string;
    path?: string;
    line?: number;
    severity?: string;
  }>,
): LicenseView {
  const shown = findings.filter((finding) => SHOWN.has(finding.ruleId));
  const declaration =
    shown.find((finding) => finding.ruleId === "license.declaration") ?? null;
  const policy = shown.find((finding) => finding.ruleId === "license.policy") ?? null;
  const inventoryLines = shown
    .filter((finding) => finding.ruleId === "license.inventory")
    .map((finding) => textOf(finding));
  const components = shown
    .filter((finding) => finding.ruleId === "license.dependency")
    .map((finding) => ({
      ruleId: finding.ruleId,
      title: finding.title ?? finding.ruleId,
      why: textOf(finding),
      path: finding.path ?? "(repo)",
      line: finding.line ?? 0,
      severity: finding.severity ?? "info",
    }));
  const shownCount = inventoryLines.length + components.length + (declaration === null ? 0 : 1) + (policy === null ? 0 : 1);
  const withheldCount = Math.max(0, findings.length - shownCount);
  const coverage: LicenseView["coverage"] =
    findings.length === 0 ? "empty" : shownCount === 0 ? "no_licence_findings" : "licence_findings";
  return {
    declaration:
      declaration === null
        ? null
        : {
            ruleId: declaration.ruleId,
            title: declaration.title ?? declaration.ruleId,
            why: textOf(declaration),
            path: declaration.path ?? "(repo)",
            line: declaration.line ?? 0,
            severity: declaration.severity ?? "info",
          },
    inventoryLines,
    components,
    policy:
      policy === null
        ? null
        : {
            ruleId: policy.ruleId,
            title: policy.title ?? policy.ruleId,
            why: textOf(policy),
            path: policy.path ?? "(repo)",
            line: policy.line ?? 0,
            severity: policy.severity ?? "info",
          },
    shownCount,
    withheldCount,
    coverage,
  };
}
