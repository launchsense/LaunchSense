// Usage diagnostics. Counts and names only. Never code, paths, or titles.

export interface DiagnosticPayload {
  stage: "alpha";
  tier: "alpha" | "pro" | "enterprise";
  harness: string;
  version: string;
  durationMs: number;
  orderSource: "jev" | "perplexity" | "table";
  ruleCounts: Record<string, number>;
}

const RULE_ID = /^[a-z0-9.-]+$/;

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
  };
}

export function diagnosticsAllowed(config: { tier?: string; diagnostics?: string; agreed?: boolean }): boolean {
  if (config.agreed !== true) return false;
  if (config.tier === "enterprise") return false;
  if (config.diagnostics === "off") return false;
  return config.tier === "alpha" || config.tier === "pro" || config.diagnostics === "on";
}
