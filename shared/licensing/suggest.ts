// The licence suggestion. A structured suggestion for the best licence, never
// a decision.
//
// Inputs are licence ids and counts only: the detected project licence, the
// declared dependency mix, and the repo allowlist from `.ls/policy.yaml`.
// Agent instruction files, file text, and paths never enter here, so there is
// nothing in the lane state that could carry them to a provider.
//
// The deterministic floor ranks observed ids: the declared project licence
// first, then allowlisted ids in the mix, then the mix by count. Copyleft,
// source-available, and proprietary terms are never picked: their terms need a
// person, so the suggestion declines and says so. A lane may reorder the
// candidates inside that suggestion. It never writes a licence fact, a finding,
// or a severity, and Unknown stays Unknown.

import { fnv1aHex } from "../redaction.ts";
import { licenseObligation } from "./obligations.ts";
import { UNKNOWN_LICENSE } from "./spdx.ts";

export type SuggestionSource = "local" | "jev" | "perplexity" | "table";

export interface SuggestionMix {
  project: string | null;
  /** Declared dependency ids with how many components declare each. */
  mix: ReadonlyArray<{ id: string; count: number }>;
  /** The repo allowlist. Empty when the repo names none. */
  allowed: readonly string[];
}

export interface SuggestionCandidate {
  id: string;
  why: string;
}

export interface LicenceSuggestion {
  /** The top pick, or null when no pick is honest. Never a fact, only a suggestion. */
  pick: string | null;
  candidates: SuggestionCandidate[];
  /** One plain line. Always carries the not-legal-advice line. */
  note: string;
  source: SuggestionSource;
}

export const SUGGESTION_NOTE =
  "A suggestion, not a licence fact. It is not legal advice, and a person decides.";

const DECLINE_FAMILIES = new Set([
  "strong-copyleft",
  "library-copyleft",
  "source-available",
  "proprietary",
]);

function familyOf(id: string): string | null {
  try {
    const family = licenseObligation(id).family;
    return family === "unknown" ? null : family;
  } catch {
    return null;
  }
}

/** An id the obligation table can name terms for, which is the readable set. */
function readableId(id: string): boolean {
  return id !== UNKNOWN_LICENSE && familyOf(id) !== null;
}

/**
 * The state a lane is asked about. Licence ids, counts, and booleans only.
 * No package names, no paths, no file text, so an agent instruction file can
 * never travel inside it.
 */
export function suggestionState(input: SuggestionMix): {
  candidates: string[];
  counts: number[];
  projectPresent: boolean;
  allowedMatches: number;
} {
  const mix = input.mix.filter((entry) => entry.id !== UNKNOWN_LICENSE && readableId(entry.id));
  const allowed = new Set(input.allowed);
  return {
    candidates: mix.map((entry) => entry.id),
    counts: mix.map((entry) => entry.count),
    projectPresent: input.project !== null && readableId(input.project),
    allowedMatches: mix.filter((entry) => allowed.has(entry.id)).length,
  };
}

/** Deterministic floor: observed ids ranked by project, allowlist, then count. */
export function suggestProjectLicence(input: SuggestionMix): LicenceSuggestion {
  const allowed = new Set(input.allowed.filter((id) => readableId(id)));
  const mix = input.mix.filter((entry) => entry.id !== UNKNOWN_LICENSE && readableId(entry.id));
  const total = mix.reduce((sum, entry) => sum + Math.max(0, entry.count), 0);
  const byId = new Map<string, number>();
  for (const entry of mix) byId.set(entry.id, (byId.get(entry.id) ?? 0) + Math.max(0, entry.count));
  const project = input.project !== null && readableId(input.project) ? input.project : null;

  const needsPerson = [project, ...byId.keys()].some(
    (id) => id !== null && DECLINE_FAMILIES.has(familyOf(id) ?? ""),
  );
  const ordered = [...byId.entries()].sort((a, b) => {
    if (project !== null) {
      if (a[0] === project && b[0] !== project) return -1;
      if (b[0] === project && a[0] !== project) return 1;
    }
    const aAllowed = allowed.has(a[0]) ? 0 : 1;
    const bAllowed = allowed.has(b[0]) ? 0 : 1;
    if (aAllowed !== bAllowed) return aAllowed - bAllowed;
    return b[1] - a[1] || (a[0] < b[0] ? -1 : 1);
  });
  const candidates: SuggestionCandidate[] = ordered.map(([id, count]) => {
    const parts: string[] = [];
    if (id === project) parts.push("the licence your repo declares");
    if (allowed.has(id)) parts.push("on your repo allowlist");
    parts.push(`declared by ${count} of ${total} components`);
    return { id, why: parts.join(", ") };
  });

  if (project === null && ordered.length === 0) {
    return {
      pick: null,
      candidates,
      note: `No licence signal to suggest from. ${SUGGESTION_NOTE}`,
      source: "table",
    };
  }
  if (needsPerson) {
    return {
      pick: null,
      candidates,
      note: `Copyleft or proprietary terms are in the mix, and those terms need a person. ${SUGGESTION_NOTE}`,
      source: "table",
    };
  }
  const pick = project ?? ordered[0]?.[0] ?? null;
  return {
    pick,
    candidates,
    note:
      pick === null
        ? `No licence signal to suggest from. ${SUGGESTION_NOTE}`
        : `Suggested ${pick} from what this repo declares. ${SUGGESTION_NOTE}`,
    source: "table",
  };
}

/** Stable question id for one candidate. The whole id is hashed, never sliced. */
export function suggestionQuestionId(id: string): string {
  return `lic-${fnv1aHex(id)}`;
}

export interface NoulLike {
  type?: string;
  noul?: number;
}

/**
 * Apply the lane answers to the floor order. One bit per candidate: is this a
 * good pick. A missing or non-numeric answer is neutral, never a no. The pick
 * stays null when the floor declined: a lane cannot talk the product into
 * recommending copyleft terms.
 */
export function orderSuggestions(
  floor: LicenceSuggestion,
  answers: Record<string, NoulLike> | null,
  source: SuggestionSource,
): LicenceSuggestion {
  if (answers === null || floor.candidates.length === 0) {
    return { ...floor, source };
  }
  const worth = new Map<string, number>();
  for (const candidate of floor.candidates) {
    const answer = answers[suggestionQuestionId(candidate.id)];
    if (answer !== undefined && typeof answer.noul === "number") {
      worth.set(candidate.id, answer.noul);
    }
  }
  const base = floor.candidates.map((candidate, i) => ({ candidate, i }));
  base.sort((a, b) => {
    const wa = worth.get(a.candidate.id);
    const wb = worth.get(b.candidate.id);
    if (wa !== undefined && wb !== undefined && wa !== wb) return wb - wa;
    return a.i - b.i;
  });
  const candidates = base.map((entry) => entry.candidate);
  const moved = candidates.some((candidate, i) => candidate.id !== floor.candidates[i]?.id);
  const pick = floor.pick === null ? null : (candidates[0]?.id ?? null);
  const note =
    floor.pick === null
      ? floor.note
      : moved
        ? `Suggested ${pick} from what this repo declares, reordered by ${source}. ${SUGGESTION_NOTE}`
        : `Suggested ${pick} from what this repo declares. Order source: ${source}. ${SUGGESTION_NOTE}`;
  return { pick, candidates, note, source };
}
