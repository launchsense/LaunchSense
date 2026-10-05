// The AI disclosure, in one place, so every surface that talks about the AI roles
// says the same thing.
//
// The vocabulary is borrowed on purpose. C2PA Technical Specification 2.4 defines
// `contentProfile.humanOversightLevel` as an enumeration of three values:
//
//   fully_autonomous   no human review after model output
//   prompt_guided      a human provided the prompts or configuration, and nobody
//                      approved the output
//   human_validated    a human reviewed and approved the final output before release
//
// We use the three words and we claim nothing else. We are not a claim generator,
// we hold no certificate chain against the C2PA Trust List, and we embed no
// manifest, so this is a vocabulary citation, not conformance. Three values that
// mean one thing everywhere are better than three words of our own.
//
// Every task below names the file that runs it. A disclosure that cannot be
// checked against the code is a promise, and this product does not make those.

/** The C2PA term, its definition, and whether this product uses it. */
export interface OversightLevel {
  value: "fully_autonomous" | "prompt_guided" | "human_validated";
  means: string;
  /** True when some path in this repository reaches this value. */
  used: boolean;
  why: string;
}

export const HUMAN_OVERSIGHT_LEVELS: readonly OversightLevel[] = [
  {
    value: "fully_autonomous",
    means: "No human review after model output.",
    used: false,
    why: "Nothing in this product writes model output without a person having asked for it first, and the one lane that runs on its own is refused rather than configured. The fixed wording and the fixed order are what ship when no provider answers.",
  },
  {
    value: "prompt_guided",
    means: "A person provided the request or the configuration, and nobody approved the output.",
    used: true,
    why: "This is every AI path in the product. A person runs a scan or presses Explain in plain words, and the output is checked against fixed rules rather than approved by a second person.",
  },
  {
    value: "human_validated",
    means: "A person reviewed and approved the final output before release.",
    used: false,
    why: "No path in this repository records a person approving a model's output. A person can accept a risk on a finding, which is recorded as their own decision, but nothing they approve is then called validated output.",
  },
];

/** One task a model is allowed to touch, with the file that runs it. */
export interface AiAssistedTask {
  id: "explain" | "ordering" | "licence_lookup";
  task: string;
  oversight_level: OversightLevel["value"];
  /** What it is not allowed to change. */
  cannot: string;
  /** The files that run it. */
  where: string[];
  /** True when a provider must be configured before this path does anything. */
  needs_configuration: boolean;
}

export const AI_ASSISTED_TASKS: readonly AiAssistedTask[] = [
  {
    id: "explain",
    task: "Rewrite a finding that a fixed rule already produced, in plainer language.",
    oversight_level: "prompt_guided",
    cannot: "It cannot add, drop, re-rank, or re-score a finding. Output that names an unknown finding, drops an actionable one, or claims a check that did not run is thrown away and fixed wording is shown instead.",
    where: ["convex/adapters/ai.ts", "convex/scans/aiExplain.ts", "shared/ai/deterministic.ts"],
    needs_configuration: true,
  },
  {
    id: "ordering",
    task: "Reorder findings that already exist, inside one severity band.",
    oversight_level: "prompt_guided",
    cannot: "It cannot change which findings exist or what severity any of them has. The fixed priority table always produces an order, and the model lane can only move items within a band that table already placed.",
    where: ["convex/adapters/decision.ts", "shared/reports/priority.ts", "convex/scans/rankScan.ts"],
    needs_configuration: true,
  },
  {
    id: "licence_lookup",
    task: "Suggest a licence id for a dependency whose declared licence could not be read.",
    oversight_level: "prompt_guided",
    cannot: "It cannot become a licence fact. A suggestion carries no rule id, no fingerprint, and no severity, it never writes into the inventory it came from, and an Unknown licence stays Unknown.",
    where: ["shared/licensing/lookup.ts"],
    needs_configuration: true,
  },
];

/** One thing no model in this product decides, with the file that proves it. */
export interface NeverDecided {
  item: string;
  why: string;
  where: string[];
}

export const AI_NEVER_DECIDES: readonly NeverDecided[] = [
  {
    item: "Whether something is a finding",
    why: "Findings come from fixed rule packs in shared/analyzers. No model writes, drops, or rewrites one.",
    where: ["shared/analyzers", "shared/reports/priority.ts"],
  },
  {
    item: "How severe a finding is",
    why: "Severity is a policy table applied to a rule id. No model sets or changes it.",
    where: ["shared/policies/severity.ts"],
  },
  {
    item: "A licence fact",
    why: "A licence is read from a lockfile or an installed manifest. A model answer is a suggestion that cannot write into the inventory, and no lane is configured in this release.",
    where: ["shared/licensing/dependencies.ts", "shared/licensing/spdx.ts", "shared/licensing/lookup.ts"],
  },
  {
    item: "Consent",
    why: "Consent is one question with one answer, written by install.sh to a file on the person's own machine. No model asks it, records it, or reads it.",
    where: ["install.sh", "shared/consent/vocabulary.ts"],
  },
  {
    item: "Who a caller is",
    why: "A credential is resolved by an indexed read and a constant-time hash compare. The harness label a caller declares never enters a rate limit key, an ownership check, or an access decision, and the verified binding is absent on every row today.",
    where: ["convex/identity", "convex/mcpLimit.ts"],
  },
  {
    item: "Whether a request is allowed",
    why: "Caps, quota, revocation, and ownership are fixed rules read on every request. No model is on that path.",
    where: ["convex/mcpLimit.ts", "convex/scans/queue.ts"],
  },
];

/** The citation, for a document that has to say where a word comes from. */
export const AI_DISCLOSURE_CITATION =
  "Human oversight level uses the humanOversightLevel vocabulary from C2PA Technical Specification 2.4, April 2026. We borrow the three words. We are not a C2PA claim generator, we hold no certificate chain, and this is not a conformance claim.";

/** The sentence a person reads. Kept short, and identical on every surface. */
export const AI_DISCLOSURE_SHORT =
  "AI rewrites a finding in plainer language and can reorder findings inside one severity band. That is all it does here. It never decides a finding, a severity, a licence fact, consent, who a caller is, or whether a request is allowed. Those come from fixed code.";

/** The same statement with the C2PA term in it, for a document or a report header. */
export const AI_DISCLOSURE_WITH_LEVEL = `${AI_DISCLOSURE_SHORT} The human oversight level for every AI path here is prompt_guided in C2PA terms: a person asked for the output and nobody approved it afterwards.`;

/** Which term applies on a given path, or null when no model is involved. */
export function oversightLevelFor(taskId: AiAssistedTask["id"]): OversightLevel["value"] | null {
  const task = AI_ASSISTED_TASKS.find((item) => item.id === taskId);
  return task?.oversight_level ?? null;
}

/** True when the product ever reaches the highest-scrutiny C2PA value. */
export function anyFullyAutonomousPath(): boolean {
  return HUMAN_OVERSIGHT_LEVELS.some((level) => level.value === "fully_autonomous" && level.used);
}