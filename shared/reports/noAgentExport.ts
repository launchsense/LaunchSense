// Plain text handoff for a developer friend with no coding agent. Copy and
// send. Same findings as the report, no tooling needed to follow.

import type { FixPlan } from "./fixPlan";

export interface ExportFinding {
  title: string;
  path: string;
  line: number;
  severity: string;
  why: string;
}

export function buildNoAgentExport(
  repoLabel: string,
  sha: string | undefined,
  findings: ExportFinding[],
  plan: FixPlan,
  notChecked: string[],
): string {
  const out: string[] = [];
  out.push(`LaunchSense check for ${repoLabel}`);
  if (sha !== undefined) out.push(`Commit: ${sha}`);
  out.push("");
  out.push("Do these in order. Each step lists what to change and why.");
  out.push("");

  if (plan.steps.length === 0) {
    out.push(
      "Nothing flagged in the files we could read. Not checked files are not passes. Re-scan after your next set of changes.",
    );
  }

  for (const step of plan.steps) {
    out.push(`Step ${step.order}: ${step.title}`);
    out.push(`Why: ${step.why}`);
    out.push(`Where: ${step.files.join(", ")}`);
    for (const item of step.checklist) out.push(`  - ${item}`);
    out.push("");
  }

  const actionable = findings.filter((f) => f.severity !== "info");
  if (actionable.length > 0) {
    out.push("Findings to confirm closed:");
    for (const f of actionable) {
      out.push(`  [ ] ${f.title} (${f.severity}) at ${f.path}:${f.line}`);
    }
    out.push("");
  }

  out.push("Not checked (do not assume these are fine):");
  for (const item of notChecked) out.push(`  - ${item}`);
  out.push("");
  out.push("Re-run the check on the new commit and compare. Unknown stays unknown.");
  return out.join("\n");
}