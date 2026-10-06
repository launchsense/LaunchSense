export const SIGN_IN_OFFER = "Sign in to read a private repo, or to read more of a public one.";

export const SIGN_IN_POLICY =
  "When you are signed in, LaunchSense uses your GitHub token on our server to download that one repository. We read up to 1,000 files and about 8MB. We do not store the file contents. We delete the token when you sign out. The guest scan does not use your token.";

/**
 * The sign-in notice version. This is the answer key to "which wording was in
 * force when the person answered", and it is written onto every consent record
 * the sign-in panel produces.
 *
 * It is deliberately not DIAGNOSTICS_NOTICE_VERSION in shared/consent/vocabulary.ts.
 * Those are two different notices in two different places: the installer asks one
 * question in a terminal, and this panel asks four questions in a browser. One
 * version string for both would make a record claim words the person never read.
 *
 * What it covers: SIGN_IN_OFFER, SIGN_IN_POLICY, and the four purpose boxes and
 * their detail lines in src/features/auth/AuthPanel.tsx.
 *
 * What it does not do: nothing re-asks anybody. The panel is only shown while
 * signed out, so a person who signs out and signs in again is asked again, and
 * that later answer records this version beside the earlier one rather than
 * overwriting it. Change a line of wording and change this string with it. The
 * upsert on (person, purpose, notice version) in convex/consent.ts is what keeps
 * the two answers apart.
 */
export const SIGN_IN_NOTICE_VERSION = "2026-10-06";