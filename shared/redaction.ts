// Central redaction engine. Every data path (evidence, findings, AI payloads,
// share cards, logs) passes through sharedRedact. Raw secrets are never stored
// or returned. Over-redaction is preferred over a leak.

import { PROVIDER_SHAPES } from "./analyzers/secretValue.ts";

export const REDACTED = "[REDACTED]";
export const MAX_SNIPPET_CHARS = 200;

const SECRET_PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/g,
  /(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /xox[bpas]-[A-Za-z0-9-]{10,}/g,
  /sk[-_](live|test)[-_][A-Za-z0-9]{10,}/g,
  /AIza[0-9A-Za-z_-]{35}/g,
];

// Redaction must be a SUPERSET of detection. The secret detector
// (shared/analyzers/secretValue.ts) accepts any PROVIDER_SHAPES match and raises a
// finding, so every one of those shapes must also be removed here, or a raw value
// could be stored. The two lists cannot drift: this is built from the same source.
// A non-global shape is re-flagged global so every occurrence on a line is replaced.
const PROVIDER_PATTERNS: RegExp[] = PROVIDER_SHAPES.map(
  (shape) => new RegExp(shape.source, shape.flags.includes("g") ? shape.flags : `${shape.flags}g`),
);

const ASSIGNMENT_PATTERN =
  /((?:password|passwd|pwd|secret|api[_-]?key|auth[_-]?token|access[_-]?token|client[_-]?secret)\s*[:=]\s*)(['"]?)([^\s'";,]{3,})/gi;

const URL_CREDENTIALS_PATTERN = /(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/g;

export function sharedRedact(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, REDACTED);
  }
  for (const pattern of PROVIDER_PATTERNS) {
    pattern.lastIndex = 0;
    out = out.replace(pattern, REDACTED);
  }
  ASSIGNMENT_PATTERN.lastIndex = 0;
  out = out.replace(
    ASSIGNMENT_PATTERN,
    (_match: string, prefix: string, quote: string): string =>
      `${prefix}${quote}${REDACTED}${quote}`,
  );
  URL_CREDENTIALS_PATTERN.lastIndex = 0;
  out = out.replace(URL_CREDENTIALS_PATTERN, `$1${REDACTED}:${REDACTED}@`);
  return out;
}

export function redactedSnippet(text: string, maxChars: number = MAX_SNIPPET_CHARS): string {
  const clean = sharedRedact(text).replace(/\s+/g, " ").trim();
  if (clean.length <= maxChars) return clean;
  return `${clean.slice(0, maxChars)}…`;
}

// FNV-1a 32-bit hex. Used for content identity in fingerprints, not for
// security. Deterministic across browser, Node, and Convex runtimes.
export function fnv1aHex(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

// Stable across line shifts: line numbers are never part of a fingerprint,
// and only the redacted snippet hash is used, never raw values. Two identical
// lines in one file would hash to one fingerprint and a dedupe would then drop
// the second, so each repeat after the first carries its own occurrence number.
// Occurrence 0 returns the fingerprint exactly as it always has, so stored
// fingerprints never change.
export function fingerprintFinding(
  ruleId: string,
  analyzerVersion: string,
  path: string,
  snippet: string,
  occurrence = 0,
): string {
  const base = `${ruleId}:${analyzerVersion}:${path}:${fnv1aHex(snippet)}`;
  return occurrence > 0 ? `${base}:${occurrence}` : base;
}

// The fingerprint without its occurrence number, which is the identity two
// identical findings in one file share.
//
// Why this exists. The occurrence number is a running count, so it depends on
// position: delete the first of two identical lines and the second is renumbered
// from 1 to 0. Matching on the number then reports the deleted finding as still
// present and the surviving one as gone, and a stored acceptance for ":1" stops
// matching a finding that never moved. Comparing by this base instead pairs a
// group of identical findings with the same group next scan and lets the counts
// do the work: two before, one after, is one fixed and one still broken.
//
// The occurrence is stripped only when the fingerprint really ends in
// `:hash:digits`, where hash is the eight hex characters this module writes. A
// plain fingerprint ends at the hash and is returned unchanged, so a hash that
// happens to be all digits is never mistaken for one.
export function baseFingerprint(fingerprint: string): string {
  const match = /:([0-9a-f]{8}):(\d+)$/.exec(fingerprint);
  if (match === null) return fingerprint;
  return `${fingerprint.slice(0, match.index)}:${match[1]}`;
}

// How many findings already in this run carry the same rule, path and redacted
// snippet. That count is the occurrence number the next identical finding takes.
export function occurrenceFor(
  earlier: Array<{ ruleId: string; path: string; redactedSnippet: string }>,
  current: { ruleId: string; path: string; redactedSnippet: string },
): number {
  let occurrence = 0;
  for (const seen of earlier) {
    if (
      seen.ruleId === current.ruleId &&
      seen.path === current.path &&
      seen.redactedSnippet === current.redactedSnippet
    ) {
      occurrence += 1;
    }
  }
  return occurrence;
}
