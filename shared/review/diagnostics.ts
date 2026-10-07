// Usage diagnostics. Counts and names only. Never code, paths, or titles.
// Governance signals are counts and a closed reason enum, never a path or a reason text.

export type GovRefusedReason =
  | "none"
  | "unreadable"
  | "sandbag"
  | "not_a_mapping"
  | "tab_indentation"
  | "anchors_not_supported"
  | "multi_document_not_supported"
  | "unsupported_version"
  | "unknown_key"
  | "accept_without_fingerprint_or_rule"
  | "accept_wildcard"
  | "accept_without_reason"
  | "accept_unknown_rule"
  | "accept_malformed_fingerprint"
  | "ignore_all_paths"
  | "ignore_without_reason"
  | "line_unreadable";

export interface GovOutcome {
  detected: boolean;
  refused: GovRefusedReason;
  stale: boolean;
  suppressedFingerprint: number;
  suppressedRulePath: number;
  suppressedRule: number;
  ignored: number;
  sandbag: boolean;
}

export interface DiagnosticPayload {
  stage: "alpha";
  tier: "alpha" | "pro" | "enterprise";
  harness: string;
  version: string;
  durationMs: number;
  orderSource: "local" | "jev" | "perplexity" | "table";
  ruleCounts: Record<string, number>;
  govDetected: boolean;
  govRefused: GovRefusedReason;
  govStale: boolean;
  govSuppressedFingerprint: number;
  govSuppressedRulePath: number;
  govSuppressedRule: number;
  govIgnored: number;
  govSandbag: boolean;
}

const RULE_ID = /^[a-z0-9.-]+$/;

const GOV_REFUSED = new Set<string>([
  "none",
  "unreadable",
  "sandbag",
  "not_a_mapping",
  "tab_indentation",
  "anchors_not_supported",
  "multi_document_not_supported",
  "unsupported_version",
  "unknown_key",
  "accept_without_fingerprint_or_rule",
  "accept_wildcard",
  "accept_without_reason",
  "accept_unknown_rule",
  "accept_malformed_fingerprint",
  "ignore_all_paths",
  "ignore_without_reason",
  "line_unreadable",
]);

function govCount(value: unknown): number {
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return 0;
  return Math.min(value, 100000);
}

export function emptyGovOutcome(): GovOutcome {
  return {
    detected: false,
    refused: "none",
    stale: false,
    suppressedFingerprint: 0,
    suppressedRulePath: 0,
    suppressedRule: 0,
    ignored: 0,
    sandbag: false,
  };
}

export function diagnosticPayload(input: DiagnosticPayload): DiagnosticPayload | null {
  if (input.tier === "enterprise") return null;
  const ruleCounts: Record<string, number> = {};
  for (const [ruleId, count] of Object.entries(input.ruleCounts)) {
    if (!RULE_ID.test(ruleId)) continue;
    if (!Number.isInteger(count) || count < 0 || count > 100000) continue;
    ruleCounts[ruleId] = count;
  }
  return {
    stage: "alpha",
    tier: input.tier,
    harness: input.harness.slice(0, 40),
    version: input.version.slice(0, 40),
    durationMs: Math.max(0, Math.min(input.durationMs, 3_600_000)),
    orderSource: input.orderSource,
    ruleCounts,
    govDetected: input.govDetected === true,
    govRefused: GOV_REFUSED.has(input.govRefused) ? input.govRefused : "none",
    govStale: input.govStale === true,
    govSuppressedFingerprint: govCount(input.govSuppressedFingerprint),
    govSuppressedRulePath: govCount(input.govSuppressedRulePath),
    govSuppressedRule: govCount(input.govSuppressedRule),
    govIgnored: govCount(input.govIgnored),
    govSandbag: input.govSandbag === true,
  };
}

export function diagnosticsAllowed(config: { tier?: string; diagnostics?: string; agreed?: boolean }): boolean {
  if (config.agreed !== true) return false;
  if (config.tier === "enterprise") return false;
  if (config.diagnostics === "off") return false;
  return config.tier === "alpha" || config.tier === "pro" || config.diagnostics === "on";
}
