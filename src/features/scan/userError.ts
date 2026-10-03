// Turns a thrown value into something a nontechnical builder can act on.
//
// The raw message is not shown. It can carry file paths, hostnames, upstream API
// text, or internal wording, and it is usually not something the user can fix.
// The detail goes to the console for debugging; the user gets one plain sentence
// plus what to do next.

/** Matches only our own deliberately user-facing throws. */
const SAFE_PREFIXES = [
  "Scan is not ready for analysis yet.",
  "File tree is missing.",
  "Paste a public GitHub repository URL to start.",
];

export function toUserError(error: unknown, fallback: string): string {
  const raw = error instanceof Error ? error.message : "";

  // Our own throws were written to be read by a user.
  if (SAFE_PREFIXES.some((prefix) => raw.startsWith(prefix))) return raw;

  // Silent by design. A production build should not spray stack traces into the
  // visitor's console, and the thrown value already reaches error reporting.
  return fallback;
}