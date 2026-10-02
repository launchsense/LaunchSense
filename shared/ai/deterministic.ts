// Deterministic fallback wording. Runs when no AI provider answers or when
// AI output fails validation. Plain, honest, no invented claims. Every
// actionable finding is covered so the ID-coverage rule always holds.

import type { ExplainableFinding, AiPlan } from "./validate";

export function deterministicPlan(findings: ExplainableFinding[]): AiPlan {
  return {
    explanations: findings
      .filter((f) => f.severity !== "info")
      .map((f) => ({ fingerprint: f.fingerprint, plain: `${f.title}. ${f.why}` })),
    notActionable: findings
      .filter((f) => f.severity === "info")
      .map((f) => ({
        fingerprint: f.fingerprint,
        reason: "Informational only. No action needed before you share.",
      })),
  };
}

export function buildExplainPrompt(findings: ExplainableFinding[]): string {
  const lines = findings.map(
    (f) =>
      `- fingerprint=${f.fingerprint} severity=${f.severity} title=${f.title} why=${f.why}`,
  );
  return [
    "You explain security and quality findings for a non-developer.",
    "Rules: never claim a check ran that is not listed here. Never say the whole repo was scanned.",
    "Return JSON only, shaped as:",
    '{"explanations":[{"fingerprint":"...","plain":"one or two short plain sentences"}],"notActionable":[{"fingerprint":"...","reason":"short"}]}',
    "Every finding whose severity is high, medium, or low must appear in explanations or in notActionable.",
    "Findings:",
    ...lines,
  ].join("\n");
}