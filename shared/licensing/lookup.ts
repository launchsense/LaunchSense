// The guarded lookup, for the only case that allows a model to speak: a
// dependency whose licence is Unknown.
//
// Three rules, and they are the whole design.
//
//   1. Only Unknown may be asked. A licence that was read is a fact, and a
//      model cannot improve on it.
//   2. The prompt may contain the package name and version and the fixed
//      wording below. Nothing else. No file path, no source line, no repository
//      name, no other component.
//   3. The answer is a suggestion. It is never a licence fact, never a finding,
//      and never a severity. It cannot become one, because this module returns
//      no rule id, no severity and no way to write into an inventory.
//
// When no lane is configured the answer is the refusal path. Unknown stays
// unknown. That is the default and it is not a degraded mode.

import { UNKNOWN_LICENSE, isKnownSpdxId, normalizeSpdxId } from "./spdx.ts";
import type { DependencyLicense } from "./dependencies.ts";

export interface LicenseLookupRequest {
  name: string;
  version: string;
  /** The declaration that could not be read, or null when nothing was declared. */
  declared: string | null;
}

/**
 * The lane that would be asked. Injected, so this module makes no request and
 * holds no key. A lane returns the bare id it would suggest, or null.
 */
export type LicenseLookupLane = (input: {
  prompt: string;
  request: LicenseLookupRequest;
}) => Promise<string | null>;

export interface LicenseSuggestion {
  name: string;
  version: string;
  /** Always this. It is the type of the record, not a field a caller can clear. */
  kind: "suggestion";
  /** The id the lane proposed, already normalized, or null. */
  suggested: string | null;
  /** True only when the answer passed the whitelist. Never a licence fact. */
  usable: boolean;
  /** Why it was refused, or why it was kept. */
  reason: string;
}

export interface LicenseLookupResult {
  /** False when no lane was supplied. The refusal path is the default. */
  configured: boolean;
  asked: number;
  suggestions: LicenseSuggestion[];
  note: string;
}

const NOT_CONFIGURED =
  "The AI lane for licence lookups is not configured, so no licence was looked up. Unknown stays unknown.";

/**
 * The only words the prompt may use besides the name and version. Held as one
 * fixed sentence so the whitelist can be checked against the built prompt
 * rather than trusted.
 */
const PROMPT_TEMPLATE =
  "Name the SPDX licence id for the npm package NAME at version VERSION. " +
  "The lockfile did not read a licence for it. " +
  "Answer with one SPDX id or the word Unknown. " +
  "Do not add words. Do not explain.";

function renderPrompt(request: LicenseLookupRequest): string {
  return PROMPT_TEMPLATE.replace("NAME", request.name).replace("VERSION", request.version);
}

/**
 * The whitelist, checked against the prompt that was actually built.
 *
 * A prompt carries the package name and version, which are public registry
 * coordinates, and the fixed sentence. Anything else means a future edit
 * widened what leaves the machine, and this fails rather than posts it.
 */
export function promptIsWhitelisted(prompt: string, request: LicenseLookupRequest): boolean {
  const template = PROMPT_TEMPLATE.replace("NAME", request.name).replace("VERSION", request.version);
  if (prompt !== template) return false;
  // No placeholder may survive the substitution, and the request's own name and
  // version must both be present. A package named "VERSIONfoo" would otherwise
  // swap the two placeholders and leave the rebuilt template matching itself, so
  // this checks the result rather than re-running the same substitution.
  if (/\bNAME\b|\bVERSION\b/.test(prompt)) return false;
  if (!prompt.includes(request.name) || !prompt.includes(request.version)) return false;
  if (prompt.includes("/") && !request.name.startsWith("@")) return false;
  return true;
}

/**
 * The answer whitelist. A bare id this product reads, or the word Unknown.
 * A sentence, a second id, a severity word, or an id nobody reads is refused.
 */
export function classifyLookupAnswer(answer: string | null): { id: string | null; reason: string } {
  if (answer === null) return { id: null, reason: "the lane returned nothing" };
  const raw = answer.trim();
  if (raw.length === 0) return { id: null, reason: "the lane returned an empty answer" };
  if (raw.length > 40) return { id: null, reason: "the answer is longer than one licence id" };
  if (/\s/.test(raw)) return { id: null, reason: "the answer is more than one word" };
  if (raw.toLowerCase() === "unknown") return { id: null, reason: "the lane also did not know" };
  if (!isKnownSpdxId(raw)) {
    return { id: null, reason: "the answer is not a licence id this product reads" };
  }
  const normalized = normalizeSpdxId(raw);
  if (normalized.unknownReason !== null) {
    return { id: null, reason: normalized.unknownReason };
  }
  return { id: normalized.id, reason: "the lane proposed an id from the list this product reads" };
}

/** Only Unknown components may be asked. A read licence is a fact. */
export function unknownLicenseRequests(
  components: DependencyLicense[],
  limit = 25,
): LicenseLookupRequest[] {
  const out: LicenseLookupRequest[] = [];
  for (const component of components) {
    if (component.spdx !== UNKNOWN_LICENSE) continue;
    if (out.length >= limit) break;
    out.push({ name: component.name, version: component.version, declared: component.declared });
  }
  return out;
}

/**
 * The refusal path, computed without a lane.
 *
 * This is the default and it is not a degraded mode: with no lane configured
 * nothing is asked, nothing is guessed, and every unknown stays unknown. It is
 * a separate function because callers on a synchronous path, the report builder
 * among them, must be able to state the refusal without awaiting a promise that
 * would resolve to it.
 */
export function licenseLookupRefusal(
  components: DependencyLicense[],
  limit = 25,
): LicenseLookupResult {
  const requests = unknownLicenseRequests(components, limit);
  return {
    configured: false,
    asked: 0,
    suggestions: [],
    note:
      requests.length === 0
        ? "No dependency licence read as Unknown, so there was nothing to look up."
        : `${NOT_CONFIGURED} ${requests.length} component(s) read as Unknown.`,
  };
}

/**
 * Ask the lane, when one is supplied.
 *
 * The result never writes back into the inventory. A suggestion is a separate
 * record the caller may show, and the component's licence stays Unknown in
 * every structure this module touches.
 */
export async function suggestUnknownLicenses(
  components: DependencyLicense[],
  options: { lane?: LicenseLookupLane | null; limit?: number } = {},
): Promise<LicenseLookupResult> {
  const limit = options.limit ?? 25;
  if (options.lane === undefined || options.lane === null) {
    return licenseLookupRefusal(components, limit);
  }
  const requests = unknownLicenseRequests(components, limit);
  const suggestions: LicenseSuggestion[] = [];
  for (const request of requests) {
    const prompt = renderPrompt(request);
    if (!promptIsWhitelisted(prompt, request)) {
      suggestions.push({
        name: request.name,
        version: request.version,
        kind: "suggestion",
        suggested: null,
        usable: false,
        reason: "the prompt did not match the noun whitelist, so nothing was asked",
      });
      continue;
    }
    const answer = await options.lane({ prompt, request });
    const classified = classifyLookupAnswer(answer);
    suggestions.push({
      name: request.name,
      version: request.version,
      kind: "suggestion",
      suggested: classified.id,
      usable: classified.id !== null,
      reason: classified.reason,
    });
  }
  const refused = suggestions.filter((item) => !item.usable).length;
  return {
    configured: true,
    asked: requests.length,
    suggestions,
    note:
      `${requests.length} unknown licence(s) were offered to the lane. ${refused} answer(s) were refused. ` +
      "Every answer here is a suggestion. None of them is a licence fact, a finding, or a severity.",
  };
}