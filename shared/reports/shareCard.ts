// Public share card projection. Counts and fix titles only. File paths,
// line numbers, and snippets never leave the server in share payloads.

import { buildFixPlan } from "./fixPlan.ts";
import type { PlanFinding } from "./fixPlan.ts";

export interface ShareCard {
  counts: { high: number; medium: number; low: number; info: number };
  steps: Array<{ order: number; title: string; why: string }>;
  notActionableCount: number;
}

export function toShareCard(findings: PlanFinding[]): ShareCard {
  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  for (const f of findings) counts[f.severity]++;
  const plan = buildFixPlan(findings);
  return {
    counts,
    steps: plan.steps.map((s) => ({ order: s.order, title: s.title, why: s.why })),
    notActionableCount: plan.notActionable.length,
  };
}
