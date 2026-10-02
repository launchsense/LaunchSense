// Output validation for AI-written findings. An explanation is rejected
// unless it covers every actionable finding or explicitly buckets it. This
// is the guard that stops invented checks and dropped findings.

import type { Severity } from "../policies/severity";

export interface ExplainableFinding {
  fingerprint: string;
  severity: Severity;
  title: string;
  why: string;
}

export interface AiExplanation {
  fingerprint: string;
  plain: string;
}

export interface NotActionable {
  fingerprint: string;
  reason: string;
}

export interface AiPlan {
  explanations: AiExplanation[];
  notActionable: NotActionable[];
}

export type ValidationResult =
  | { ok: true; value: AiPlan }
  | { ok: false; reason: string };

// Rule words an AI might invent to claim a check that never ran. Any hit is
// a rejection, not a warning.
const FORBIDDEN_CLAIMS = [
  /\bscanned?\s+the\s+(whole|entire)\s+repo\b/i,
  /\ball\s+files\s+(were\s+)?(checked|scanned|analyz)/i,
  /\bno\s+(issues|vulnerabilit|problems)\s+(found|exist)\s+anywhere\b/i,
  /\bcertif/i,
  /\bcompliant\b/i,
  /\bguaranteed\b/i,
];

function unique(values: string[]): Set<string> {
  return new Set(values);
}

export function validateAiPlan(
  raw: unknown,
  findings: ExplainableFinding[],
): ValidationResult {
  if (typeof raw !== "object" || raw === null) {
    return { ok: false, reason: "AI returned a non-object plan." };
  }
  const record = raw as Record<string, unknown>;
  const rawExplanations = record["explanations"];
  const rawNotActionable = record["notActionable"];
  if (!Array.isArray(rawExplanations) || !Array.isArray(rawNotActionable)) {
    return { ok: false, reason: "AI plan is missing explanations or notActionable." };
  }

  const actionable = findings.filter((f) => f.severity !== "info");
  const known = unique(findings.map((f) => f.fingerprint));

  const explanations: AiExplanation[] = [];
  for (const item of rawExplanations) {
    if (typeof item !== "object" || item === null) return { ok: false, reason: "Bad explanation entry." };
    const entry = item as Record<string, unknown>;
    const fp = entry["fingerprint"];
    const plain = entry["plain"];
    if (typeof fp !== "string" || typeof plain !== "string") {
      return { ok: false, reason: "Explanation entry missing fingerprint or text." };
    }
    if (!known.has(fp)) {
      return { ok: false, reason: `AI referenced an unknown finding id: ${fp}` };
    }
    if (plain.length === 0 || plain.length > 600) {
      return { ok: false, reason: "Explanation text length is out of range." };
    }
    for (const pattern of FORBIDDEN_CLAIMS) {
      if (pattern.test(plain)) {
        return { ok: false, reason: `AI made a claim we cannot support: ${plain.slice(0, 80)}` };
      }
    }
    explanations.push({ fingerprint: fp, plain });
  }

  const notActionable: NotActionable[] = [];
  for (const item of rawNotActionable) {
    if (typeof item !== "object" || item === null) {
      return { ok: false, reason: "Bad not-actionable entry." };
    }
    const entry = item as Record<string, unknown>;
    const fp = entry["fingerprint"];
    const reason = entry["reason"];
    if (typeof fp !== "string" || typeof reason !== "string") {
      return { ok: false, reason: "not-actionable entry missing fields." };
    }
    if (!known.has(fp)) {
      return { ok: false, reason: `AI bucketed an unknown finding id: ${fp}` };
    }
    notActionable.push({ fingerprint: fp, reason: reason.slice(0, 300) });
  }

  const explained = unique(explanations.map((e) => e.fingerprint));
  const bucketed = unique(notActionable.map((e) => e.fingerprint));
  const missing = actionable.filter(
    (f) => !explained.has(f.fingerprint) && !bucketed.has(f.fingerprint),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      reason: `AI dropped ${missing.length} actionable finding(s): ${missing
        .map((m) => m.fingerprint)
        .join(", ")}`,
    };
  }

  return { ok: true, value: { explanations, notActionable } };
}