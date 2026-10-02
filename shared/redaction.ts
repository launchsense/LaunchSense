// Central redaction engine. Every data path (evidence, findings, AI payloads,
// share cards, logs) passes through sharedRedact. Raw secrets are never stored
// or returned. Over-redaction is preferred over a leak.

export const REDACTED = "[REDACTED]";
export const MAX_SNIPPET_CHARS = 200;

const SECRET_PATTERNS: RegExp[] = [
  /AKIA[0-9A-Z]{16}/g,
  /(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}/g,
  /github_pat_[A-Za-z0-9_]{20,}/g,
  /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
  /xox[bpas]-[A-Za-z0-9-]{10,}/g,
  /sk-(live|test)-[A-Za-z0-9]{10,}/g,
  /AIza[0-9A-Za-z_-]{35}/g,
];

const ASSIGNMENT_PATTERN =
  /((?:password|passwd|pwd|secret|api[_-]?key|auth[_-]?token|access[_-]?token|client[_-]?secret)\s*[:=]\s*)(['"]?)([^\s'";,]{3,})/gi;

const URL_CREDENTIALS_PATTERN = /(https?:\/\/)([^/\s:@]+):([^/\s@]+)@/g;

export function sharedRedact(text: string): string {
  let out = text;
  for (const pattern of SECRET_PATTERNS) {
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
// and only the redacted snippet hash is used, never raw values.
export function fingerprintFinding(
  ruleId: string,
  analyzerVersion: string,
  path: string,
  snippet: string,
): string {
  return `${ruleId}:${analyzerVersion}:${path}:${fnv1aHex(snippet)}`;
}
