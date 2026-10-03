// Priority by decision lane, with a deterministic floor.
//
// This file is PURE. It holds no network code and imports nothing from convex/. The
// network call lives in convex/scans/priority.ts, the same split the writing lane
// uses: shared/ai/deterministic.ts builds the prompt, convex/scans/aiExplain.ts
// makes the call. Keeping shared/ pure is what lets these rules be unit tested with
// no runtime.
//
// What this file is allowed to do: order and prioritise the findings the
// deterministic checks already found. Which of these first, is this worth the
// builder's time.
//
// What this file must NEVER do: decide what is a finding, pick the work that runs,
// or change the set of findings. The product promises "AI never decides what is a
// finding" in three public documents, and tests hold that line in place.
//
// The floor rule: a scan never fails because the decision lane failed. If no
// provider answers, tableOrder produces the order. The table is always present.

import type { Severity } from "../policies/severity";

export interface RankableFinding {
  fingerprint: string;
  severity: Severity;
  ruleId: string;
  title: string;
}

export interface RankResult {
  /** Ordered fingerprints, most urgent first. Always covers every actionable finding. */
  order: string[];
  source: "jev" | "perplexity" | "table";
  /** One plain line explaining the ordering, safe to show a user. */
  note: string;
}

const SEVERITY_RANK: Record<Severity, number> = { high: 0, medium: 1, low: 2, info: 3 };

/** Matches the ruleIds that usually mean a live credential a stranger can use. */
function isCredential(ruleId: string): boolean {
  return /secret|credential|key|token/i.test(ruleId);
}

/**
 * The floor. Deterministic, always available, never removed.
 *
 * Credential-shaped findings first, then by severity, then by fingerprint so the
 * order is stable across runs. The ruleIds are matched by pattern, not by a list, so
 * this does not need updating every time an analyzer adds a rule.
 */
export function tableOrder(findings: RankableFinding[]): string[] {
  return [...findings]
    .sort((a, b) => {
      const aCred = isCredential(a.ruleId) ? 1 : 0;
      const bCred = isCredential(b.ruleId) ? 1 : 0;
      if (aCred !== bCred) return bCred - aCred;
      const sev = SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity];
      if (sev !== 0) return sev;
      return a.fingerprint.localeCompare(b.fingerprint);
    })
    .map((f) => f.fingerprint);
}

/** Only actionable findings (high, medium, low) are ranked. Info is not an action. */
export function actionableFindings(findings: RankableFinding[]): RankableFinding[] {
  return findings.filter((f) => f.severity !== "info");
}

/** Stable question id for one finding. Must be deterministic or answers cannot map back. */
export function questionIdFor(fingerprint: string): string {
  return `w${fingerprint.replace(/[^a-zA-Z0-9]/g, "_").slice(0, 40)}`;
}

export interface NoulAnswerLike {
  type?: string;
  noul?: number;
}

/**
 * Apply the lane's answers to the table order.
 *
 * The lane is used for ONE bit per finding: is this worth fixing before sharing.
 * Two rules keep it honest and keep the checks in charge:
 *
 *   1. The lane may only reorder WITHIN a severity band. A medium finding can never
 *      rise above a high one, so the lane cannot override the severity the checks
 *      assigned.
 *   2. A missing or non-numeric answer is not a signal. It is never read as a false,
 *      because a missing answer and a "no" are indistinguishable downstream, and
 *      that class of mistake has already cost this product once.
 */
export function rankFromAnswers(
  findings: RankableFinding[],
  answers: Record<string, NoulAnswerLike> | null,
  source: "jev" | "perplexity" | "table",
): RankResult {
  const pool = actionableFindings(findings);
  const floor = tableOrder(pool);

  if (pool.length === 0) {
    return { order: [], source: "table", note: "Nothing actionable to rank." };
  }
  if (answers === null) {
    return {
      order: floor,
      source: "table",
      note: "Ordered by severity and credential risk.",
    };
  }

  const worth = new Map<string, number>();
  for (const f of pool) {
    const answer = answers[questionIdFor(f.fingerprint)];
    if (answer !== undefined && typeof answer.noul === "number") {
      worth.set(f.fingerprint, answer.noul);
    }
  }

  const floorIndex = new Map(floor.map((fp, i) => [fp, i]));
  const severityOf = new Map(pool.map((f) => [f.fingerprint, f.severity]));

  const ordered = [...floor].sort((a, b) => {
    const sev =
      SEVERITY_RANK[severityOf.get(a) ?? "info"] - SEVERITY_RANK[severityOf.get(b) ?? "info"];
    if (sev !== 0) return sev;
    const wa = worth.get(a);
    const wb = worth.get(b);
    if (wa !== undefined && wb !== undefined && wa !== wb) return wb - wa;
    return (floorIndex.get(a) ?? 0) - (floorIndex.get(b) ?? 0);
  });

  const moved = ordered.filter((fp, i) => floor[i] !== fp).length;
  if (moved === 0) {
    return {
      order: ordered,
      source,
      note: "Ordered by severity and credential risk.",
    };
  }
  return {
    order: ordered,
    source,
    note: `Ordered by severity, with ${moved} item(s) reordered inside their severity band.`,
  };
}

/**
 * The state sent to the lane. Titles and severities only. This is deliberately the
 * smallest thing that can answer the question. `decide` refuses the call outright if
 * any of this is key-shaped, so a leaked secret in a finding title cannot travel.
 */
export function rankState(findings: RankableFinding[]): Array<Record<string, string>> {
  return actionableFindings(findings)
    .slice(0, 10)
    .map((f) => ({ title: f.title, severity: f.severity, ruleId: f.ruleId }));
}